#pragma once

#include "CoreMinimal.h"

namespace Sailing
{
struct FJetSkiMotion
{
    FVector2D VelocityMps = FVector2D::ZeroVector;
    double YawRad = 0;
    double YawRate = 0;
    double BankDegrees = 0;
    double Jet = 0;

    FVector2D Bow() const { return {FMath::Cos(YawRad), FMath::Sin(YawRad)}; }
    double SpeedMps() const { return VelocityMps.Size(); }
    double SurgeMps() const { return FVector2D::DotProduct(VelocityMps, Bow()); }
    double Planing() const { return FMath::SmoothStep(4., 13., SurgeMps()); }

    void Advance(double Throttle, double Steering, double Dt)
    {
        Jet = FMath::FInterpTo(Jet, Throttle, Dt, 7.);
        const double PlaningLoad = Planing();
        const double OffPower = .16 * FMath::SmoothStep(0., 6., SpeedMps());
        const double Reverse = Jet < 0 && SurgeMps() < .2 ? -1. : 1.;
        const double Turn = Steering * Reverse * (OffPower + 1.90 * FMath::Abs(Jet)) * FMath::Lerp(1., .57, PlaningLoad);
        YawRate = FMath::FInterpTo(YawRate, Turn, Dt, 9.);
        YawRad = FMath::UnwindRadians(YawRad + YawRate * Dt);

        const FVector2D Ahead = Bow();
        const FVector2D Beam(-Ahead.Y, Ahead.X);
        const double Surge = FVector2D::DotProduct(VelocityMps, Ahead);
        const double Sway = FVector2D::DotProduct(VelocityMps, Beam);
        // The reverse bucket first slows forward motion and then backs up at low speed.
        const double Acceleration = Jet * (Jet >= 0 ? 8.4 : Surge > .8 ? 11. : 3.6);
        const double Drag = .16 + .014 * FMath::Abs(Surge) + .13 * (1. - FMath::Abs(Jet));
        const double Forward = FMath::Clamp(Surge * FMath::Exp(-Drag * Dt) + Acceleration * Dt, -2.9, 22.);
        const double Across = Sway * FMath::Exp(-FMath::Lerp(5., 3.4, PlaningLoad) * Dt);
        VelocityMps = Ahead * Forward + Beam * Across;
        BankDegrees = FMath::FInterpTo(BankDegrees, FMath::Clamp(YawRate * Forward * 1.15, -24., 24.), Dt, 6.);
    }
};
}
