#include "SailingPhysics.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingSurfaceTest, "Sailing.Sea.SurfaceDerivatives",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingSurfaceTest::RunTest(const FString& Parameters)
{
    const FVector2D Position(12.31, -8.70);
    constexpr double Time = 28.3;
    constexpr double Step = 0.0001;
    const Sailing::FSeaSample Water = Sailing::SampleSea(Position, Time);
    const double Dx = (Sailing::SampleSea(Position + FVector2D(Step, 0), Time).HeightM
        - Sailing::SampleSea(Position - FVector2D(Step, 0), Time).HeightM) / (2.0 * Step);
    const double Dt = (Sailing::SampleSea(Position, Time + Step).HeightM
        - Sailing::SampleSea(Position, Time - Step).HeightM) / (2.0 * Step);
    TestEqual(TEXT("Normal uses the slope of the rendered height function"), Water.Gradient.X, Dx, 1e-6);
    TestEqual(TEXT("Surface rise matches vertical water velocity"), Water.VelocityMps.Z, Dt, 1e-6);
    TestTrue(TEXT("Wind chop motion fades at depth"),
        Sailing::SampleSea(Position, Time, 200.0).VelocityMps.Size() < 1e-6);

    const Sailing::FSeaFrame Storm{ 76.25f, 2.25f };
    const FVector2D AlongRoute(382.13, -90.24);
    double PackedHeight = 0;
    FVector2D PackedGradient = FVector2D::ZeroVector;
    for (int32 I = 0; I < Sailing::SeaWaveCount; ++I)
    {
        const FLinearColor Mode = Sailing::SeaWaveParameter(I, Storm);
        const FVector2D WaveNumber(Mode.R, Mode.G);
        const double Phase = FVector2D::DotProduct(WaveNumber, AlongRoute) + Mode.A;
        const double Crest = FMath::Cos(Phase);
        PackedHeight += Mode.B * (Crest + Sailing::SeaCrestShape * (Crest * Crest - 0.5));
        PackedGradient -= WaveNumber * Mode.B * FMath::Sin(Phase) * (1.0 + 2.0 * Sailing::SeaCrestShape * Crest);
    }
    const Sailing::FSeaSample StormSurface = Sailing::SampleSea(AlongRoute, Storm.TimeS, 0, Storm.Scale);
    TestEqual(TEXT("Packed GPU spectrum preserves storm draft"), PackedHeight, StormSurface.HeightM, 1e-5);
    TestTrue(TEXT("Packed GPU spectrum preserves storm slope"), PackedGradient.Equals(StormSurface.Gradient, 1e-5));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingForcesTest, "Sailing.Yacht.ForceDirections",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingForcesTest::RunTest(const FString& Parameters)
{
    Sailing::FHelm Helm;
    const FVector Forward = FVector::ForwardVector;
    const Sailing::FSail Port = Sailing::SolveSail(Forward, {-6.0, 6.0, 0.0}, Helm);
    const Sailing::FSail Starboard = Sailing::SolveSail(Forward, {-6.0, -6.0, 0.0}, Helm);
    TestTrue(TEXT("A close reach drives forward"), Port.ForceN.X > 0.0);
    TestEqual(TEXT("Drive matches on mirrored tacks"), Port.ForceN.X, Starboard.ForceN.X, 1e-6);
    TestEqual(TEXT("Side force mirrors across the centerline"), Port.ForceN.Y, -Starboard.ForceN.Y, 1e-6);
    TestTrue(TEXT("Head to wind has no positive drive"),
        Sailing::SolveSail(Forward, {-8.0, 0.0, 0.0}, Helm).ForceN.X <= 0.0);

    constexpr double Time = 7.0;
    Sailing::FRigidState Hull = { {10, 4, 3}, {10, 4, 3}, FQuat::Identity, {5, 0, 0}, FVector::ZeroVector };
    TestEqual(TEXT("Dry pontoons exert zero buoyancy"), Sailing::CalculateLoads(Hull, Helm, Time).ForceN.Z, 0.0, 1e-6);
    Hull.OriginM.Z = Hull.CenterOfMassM.Z = 0.0;
    const double NeutralAhead = Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z;
    Helm.Rudder = 1.0;
    TestTrue(TEXT("Starboard helm yaws to starboard under forward flow"),
        Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z > NeutralAhead);
    Hull.VelocityMps.X = -5.0;
    const double SteeredAstern = Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z;
    Helm.Rudder = 0.0;
    TestTrue(TEXT("Rudder response reverses under backward flow"),
        SteeredAstern < Sailing::CalculateLoads(Hull, Helm, Time).TorqueNm.Z);
    return true;
}
#endif
