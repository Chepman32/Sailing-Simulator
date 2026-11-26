#pragma once

#include "CoreMinimal.h"

namespace Sailing
{
constexpr double SharkTurnRate = 36.; // degrees per second
constexpr double SharkTurnAcceleration = 58.;
constexpr double SharkCruiseFloor = 95.;
constexpr double SharkTopSpeed = 880.;
constexpr double SharkBraking = 235.; // centimetres per second squared

struct FSharkMotion
{
    FVector2D Position = FVector2D::ZeroVector;
    FVector2D Direction{1,0};
    double Speed = 156.;
    double YawRate = 0;
    double Pitch = 0, Bank = 0;
    double Phase = 0, Stroke = .52, TailDrop = 0;

    FVector4f SwimDeformation() const
    {
        return FVector4f{float(FMath::Cos(Phase)*Stroke), float(FMath::Sin(Phase)*Stroke),
                         float(32.*YawRate/SharkTurnRate), float(TailDrop)};
    }
};

inline void AdvanceSharkMotion(FSharkMotion& Shark, FVector2D Desired, bool bCanAdvance,
                               double ClimbCmS, double SurfaceWeight, double Dt)
{
    // Tail thrust moves the shark forward while water resistance limits how quickly it can turn or change speed.
    const double Angle = FMath::Atan2(FVector2D::CrossProduct(Shark.Direction,Desired),
                                     FVector2D::DotProduct(Shark.Direction,Desired));
    const double TurnLimit = FMath::Min(SharkTurnRate,FMath::RadiansToDegrees(FMath::Max(75.,Shark.Speed)/460.));
    const double TargetYaw = FMath::Clamp(FMath::RadiansToDegrees(Angle)*1.05,-TurnLimit,TurnLimit);
    const double LastYaw = Shark.YawRate;
    const double LastSpeed = Shark.Speed;
    Shark.YawRate += FMath::Clamp((TargetYaw-LastYaw)*3.2,-SharkTurnAcceleration,SharkTurnAcceleration)*Dt;
    const double Alignment = .48+.52*FMath::Max(0.,FMath::Cos(Angle));
    const double TargetSpeed = bCanAdvance ? FMath::Clamp(Desired.Size(),SharkCruiseFloor,SharkTopSpeed)*Alignment : 0.;
    Shark.Speed += FMath::Clamp((TargetSpeed-LastSpeed)*2.0,-SharkBraking,155.)*Dt;

    const double Turn = (LastYaw+Shark.YawRate)*.5*Dt;
    Shark.Position += Shark.Direction.GetRotated(Turn*.5)*((LastSpeed+Shark.Speed)*.5*Dt);
    Shark.Direction = Shark.Direction.GetRotated(Turn);

    const double Effort = FMath::SmoothStep(135.,730.,Shark.Speed);
    const double AccelerationEffort = .7*FMath::SmoothStep(28.,200.,TargetSpeed-Shark.Speed);
    const double StrokeTarget = FMath::Lerp(.44,1.,FMath::Max(Effort,AccelerationEffort));
    Shark.Stroke = FMath::Lerp(Shark.Stroke,StrokeTarget,1.-FMath::Exp(-2.4*Dt));
    Shark.Phase = FMath::Fmod(Shark.Phase + UE_DOUBLE_TWO_PI*Dt*FMath::Lerp(.43,1.13,Effort), UE_DOUBLE_TWO_PI);
    Shark.TailDrop = FMath::Lerp(Shark.TailDrop,24.*SurfaceWeight,1.-FMath::Exp(-2.4*Dt));

    const double Pitch = FMath::RadiansToDegrees(FMath::Atan2(.47*ClimbCmS,FMath::Max(180.,Shark.Speed)));
    const double Bank = FMath::RadiansToDegrees(FMath::Atan2(FMath::DegreesToRadians(Shark.YawRate)*Shark.Speed,980.));
    Shark.Pitch = FMath::Lerp(Shark.Pitch,FMath::Clamp(Pitch,-26.,26.)+3.2*SurfaceWeight,1.-FMath::Exp(-3.2*Dt));
    Shark.Bank = FMath::Lerp(Shark.Bank,FMath::Clamp(Bank,-12.,12.),1.-FMath::Exp(-2.9*Dt));
}
}
