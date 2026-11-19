#include "SailingPhysics.h"

#include "Containers/StaticArray.h"

namespace Sailing
{
namespace
{
constexpr double Gravity = 9.81;
constexpr double WaterDensity = 1025.0;
constexpr double AirDensity = 1.225;
constexpr double SailAreaM2 = 80.0;
constexpr double PontoonAreaM2 = 1.95;
constexpr double HeaveDamping = 2000.0;

struct FWave
{
    double WavelengthM;
    double AmplitudeM;
    double DirectionDegrees;
    double PhaseRad;
};

constexpr FWave Waves[] = {
    { 55.0, 0.32, 155.0, 0.7 }, { 32.0, 0.22, 202.0, 1.4 },
    { 19.0, 0.25, 115.0, 3.3 }, { 14.0, 0.195, 73.0, 4.1 },
    { 9.7, 0.151, 139.0, 5.6 }, { 6.7, 0.118, 212.0, 1.9 },
    { 4.75, 0.084, 89.0, 2.7 }, { 3.45, 0.062, 154.0, 0.9 },
};
static_assert(UE_ARRAY_COUNT(Waves) == SeaWaveCount);

struct FWaveMode
{
    FVector2D Direction;
    double K;
    double Omega;
    double AmplitudeM;
    double PhaseRad;
};

const auto WaveModes = []
{
    TStaticArray<FWaveMode, UE_ARRAY_COUNT(Waves)> Modes;
    for (int32 Index = 0; Index < Modes.Num(); ++Index)
    {
        const FWave& Wave = Waves[Index];
        const double Angle = FMath::DegreesToRadians(Wave.DirectionDegrees);
        const double K = 2.0 * UE_DOUBLE_PI / Wave.WavelengthM;
        Modes[Index] = { { FMath::Cos(Angle), FMath::Sin(Angle) }, K,
            FMath::Sqrt(Gravity * K), Wave.AmplitudeM, Wave.PhaseRad };
    }
    return Modes;
}();

FVector RightOf(const FVector& Forward)
{
    return FVector::CrossProduct(FVector::UpVector, Forward);
}
}

FSeaSample SampleSea(FVector2D XYm, double TimeS, double DepthM, double Scale)
{
    FSeaSample Result;
    for (const FWaveMode& Mode : WaveModes)
    {
        const double Phase = Mode.K * FVector2D::DotProduct(Mode.Direction, XYm)
            - Mode.Omega * TimeS + Mode.PhaseRad;
        double Sin, Cos;
        FMath::SinCos(&Sin, &Cos, Phase);
        const double Amplitude = Mode.AmplitudeM * Scale;
        const double CrestSlope = Sin * (1.0 + 2.0 * SeaCrestShape * Cos);
        Result.HeightM += Amplitude * (Cos + SeaCrestShape * (Cos * Cos - 0.5));
        Result.Gradient -= Mode.Direction * (Mode.K * Amplitude * CrestSlope);

        const double Attenuation = DepthM > 0.0 ? FMath::Exp(-Mode.K * DepthM) : 1.0;
        const double Speed = Mode.Omega * Amplitude * Attenuation;
        Result.VelocityMps += FVector(Mode.Direction.X * Cos, Mode.Direction.Y * Cos, CrestSlope) * Speed;
    }
    return Result;
}

FLinearColor SeaWaveParameter(int32 Index, FSeaFrame Frame)
{
    const FWaveMode& Mode = WaveModes[Index];
    return FLinearColor(Mode.Direction.X * Mode.K, Mode.Direction.Y * Mode.K, Mode.AmplitudeM * Frame.Scale,
        FMath::Fmod(Mode.PhaseRad - Mode.Omega * Frame.TimeS, 2.0 * UE_DOUBLE_PI));
}

FVector TrueWind(double TimeS, double SeaScale)
{
    const double TowardRad = FMath::DegreesToRadians(-93.0 + 4.0 * FMath::Sin(TimeS * 0.041));
    const double Speed = 8.5 * (1.0 + 0.12 * FMath::Sin(TimeS * 0.091) + 0.04 * FMath::Sin(TimeS * 0.37));
    return FVector(FMath::Cos(TowardRad), FMath::Sin(TowardRad), 0.0) * (Speed * FMath::Sqrt(SeaScale));
}

FSail SolveSail(const FVector& Forward, const FVector& RelativeAir, const FHelm& Helm)
{
    FSail Result;
    const FVector Right = RightOf(Forward);
    const double AirForward = FVector::DotProduct(RelativeAir, Forward);
    const double AirRight = FVector::DotProduct(RelativeAir, Right);
    const double SpeedSquared = FMath::Square(AirForward) + FMath::Square(AirRight);
    if (SpeedSquared < 1e-6)
    {
        return Result;
    }

    Result.ApparentSpeedMps = FMath::Sqrt(SpeedSquared);
    Result.ApparentAngleRad = FMath::Atan2(-AirRight, -AirForward);
    const double AngleDeg = FMath::RadiansToDegrees(FMath::Abs(Result.ApparentAngleRad));
    const double SheetDeg = Helm.bAutoTrim ? FMath::Clamp(AngleDeg - 16.0, 7.0, 87.0)
        : FMath::Lerp(7.0, 87.0, FMath::Clamp(Helm.SheetEase, 0.0, 1.0));
    Result.SheetAngleRad = FMath::DegreesToRadians(SheetDeg);

    const double Alpha = FMath::DegreesToRadians(FMath::Clamp(AngleDeg - SheetDeg, 0.0, 90.0));
    constexpr double Stall = UE_DOUBLE_PI * 18.0 / 180.0;
    const double Attached = 1.22 * FMath::Sin(0.5 * UE_DOUBLE_PI * FMath::Min(Alpha / Stall, 1.0));
    const double Separation = FMath::SmoothStep(Stall, 0.62, Alpha);
    const double Fill = FMath::SmoothStep(28.0, 46.0, AngleDeg) * FMath::SmoothStep(0.0, 0.12, Alpha);
    const double Lift = Fill * FMath::Lerp(Attached, 1.12 * FMath::Sin(2.0 * Alpha), Separation);
    const double Drag = 0.025 + Fill * (0.08 * FMath::Square(Lift) + 1.10 * FMath::Square(FMath::Sin(Alpha)));

    const FVector DragDir = (Forward * AirForward + Right * AirRight) / Result.ApparentSpeedMps;
    const double Tack = AirRight >= 0.0 ? 1.0 : -1.0;
    const FVector LiftDir = (Forward * FMath::Abs(AirRight) - Right * (Tack * AirForward)) / Result.ApparentSpeedMps;
    Result.ForceN = 0.5 * AirDensity * SpeedSquared * SailAreaM2 * (Lift * LiftDir + Drag * DragDir);
    return Result;
}

FLoads CalculateLoads(const FRigidState& State, const FHelm& Helm, double TimeS, double SeaScale)
{
    FLoads Loads;
    const auto Point = [&State](const FVector& LocalM) { return State.OriginM + State.Rotation.RotateVector(LocalM); };
    const auto VelocityAt = [&State](const FVector& WorldM)
    {
        return State.VelocityMps + FVector::CrossProduct(State.AngularVelocityRad, WorldM - State.CenterOfMassM);
    };
    const auto Apply = [&State, &Loads](const FVector& ForceN, const FVector& WorldM)
    {
        Loads.ForceN += ForceN;
        Loads.TorqueNm += FVector::CrossProduct(WorldM - State.CenterOfMassM, ForceN);
    };

    constexpr double StationsX[] = { -4.0, -1.4, 1.4, 4.0 };
    constexpr double StationsY[] = { -1.9, 1.9 };
    for (const double X : StationsX)
    {
        for (const double Y : StationsY)
        {
            const FVector Station = Point({ X, Y, -0.43 });
            const FSeaSample Sea = SampleSea({ Station.X, Station.Y }, TimeS, 0.0, SeaScale);
            const double Depth = FMath::Clamp(Sea.HeightM - Station.Z, 0.0, 1.35);
            const double RelativeUp = VelocityAt(Station).Z - Sea.VelocityMps.Z;
            const double Buoyancy = WaterDensity * Gravity * PontoonAreaM2 * Depth;
            const double Damping = HeaveDamping * FMath::Min(Depth / 0.12, 1.0) * RelativeUp;
            Apply(FVector::UpVector * FMath::Max(0.0, Buoyancy - Damping), Station);
        }
    }

    const FVector Forward = State.Rotation.GetForwardVector().GetSafeNormal2D();
    const FVector Right = RightOf(Forward);
    const FVector CenterOfEffort = Point({ 0.25, 0.0, 4.4 });
    Apply(SolveSail(Forward, TrueWind(TimeS, SeaScale) - VelocityAt(CenterOfEffort), Helm).ForceN, CenterOfEffort);

    const FVector Keel = Point({ 0.0, 0.0, -0.78 });
    const FSeaSample KeelSea = SampleSea({ Keel.X, Keel.Y }, TimeS, FMath::Max(0.0, -Keel.Z), SeaScale);
    const double HullWet = FMath::SmoothStep(-0.12, 0.35, KeelSea.HeightM - Keel.Z);
    const FVector Flow = VelocityAt(Keel) - KeelSea.VelocityMps;
    const double U = FVector::DotProduct(Flow, Forward);
    const double V = FVector::DotProduct(Flow, Right);
    const double KeelLimit = 750.0 * (U * U + V * V);
    const double KeelLift = FMath::Clamp(-1550.0 * FMath::Abs(U) * V, -KeelLimit, KeelLimit);
    const double Surge = -(65.0 * U + 165.0 * U * FMath::Abs(U));
    const double Sway = KeelLift - (280.0 * V + 900.0 * V * FMath::Abs(V));
    Apply(HullWet * (Forward * Surge + Right * Sway), Keel);

    const double Throttle = FMath::Clamp(Helm.Throttle, -1.0, 1.0);
    const double Thrust = Helm.bEngineOn ? (Throttle >= 0.0 ? 5000.0 : 2900.0) * Throttle : 0.0;
    Apply(HullWet * Forward * Thrust, Point({ -3.8, 0.0, -0.55 }));

    const FVector Rudder = Point({ -4.7, 0.0, -0.62 });
    const FSeaSample RudderSea = SampleSea({ Rudder.X, Rudder.Y }, TimeS, FMath::Max(0.0, -Rudder.Z), SeaScale);
    const double RudderWet = FMath::SmoothStep(-0.08, 0.35, RudderSea.HeightM - Rudder.Z);
    const FVector SternFlow = VelocityAt(Rudder) - RudderSea.VelocityMps;
    const double PropWash = 0.35 * FMath::Sqrt(2.0 * FMath::Max(0.0, Thrust) / (WaterDensity * 0.42));
    const double RawAxial = FVector::DotProduct(SternFlow, Forward) + PropWash;
    const double AxialSpeed = FMath::Abs(RawAxial);
    const double EffectiveAxial = FMath::Sign(RawAxial) * (FMath::Min(AxialSpeed, 3.8) + 0.25 * FMath::Max(0.0, AxialSpeed - 3.8));
    const double Delta = FMath::DegreesToRadians(32.0) * FMath::Clamp(Helm.Rudder, -1.0, 1.0);
    const double OpposingSide = -520.0 * (FMath::Sin(Delta) * FMath::Cos(Delta) * EffectiveAxial
        + 0.42 * FVector::DotProduct(SternFlow, Right)) * FMath::Abs(EffectiveAxial);
    const double RudderDrag = -FMath::Sign(U) * FMath::Abs(OpposingSide * FMath::Sin(Delta)) * 0.65;
    Apply(RudderWet * (Right * OpposingSide + Forward * RudderDrag), Rudder);

    const FVector LocalRates = State.Rotation.UnrotateVector(State.AngularVelocityRad);
    Loads.TorqueNm -= HullWet * State.Rotation.RotateVector(LocalRates * FVector(4200.0, 6500.0, 4200.0));
    return Loads;
}
}
