#pragma once

#include "CoreMinimal.h"

namespace Sailing
{
inline constexpr double MassKg = 6200.0;
inline constexpr double KnotsPerMps = 1.94384449;
inline constexpr double MaxRudderDegrees = 32.0;
inline constexpr int32 SeaWaveCount = 8;
inline constexpr double SeaCrestShape = 0.27;

struct FSeaFrame
{
    float TimeS = 0.0f;
    float Scale = 1.0f;
};

struct FSeaSample
{
    double HeightM = 0.0;
    FVector2D Gradient = FVector2D::ZeroVector;
    FVector VelocityMps = FVector::ZeroVector;
};

struct FHelm
{
    double Rudder = 0.0;
    double Throttle = 0.0;
    double SheetEase = 0.50;
    bool bEngineOn = false;
    bool bAutoTrim = true;
    bool bHoveTo = false;
    FVector2D AnchorM = FVector2D::ZeroVector;
};

struct FSail
{
    FVector ForceN = FVector::ZeroVector;
    double ApparentAngleRad = 0.0;
    double ApparentSpeedMps = 0.0;
    double SheetAngleRad = 0.0;
};

struct FRigidState
{
    FVector OriginM;
    FVector CenterOfMassM;
    FQuat Rotation;
    FVector VelocityMps;
    FVector AngularVelocityRad;
};

struct FLoads
{
    FVector ForceN = FVector::ZeroVector;
    FVector TorqueNm = FVector::ZeroVector;
};

FSeaSample SampleSea(FVector2D XYm, double TimeS, double DepthM = 0.0, double Scale = 1.0);
FLinearColor SeaWaveParameter(int32 Index, FSeaFrame Frame);
FVector TrueWind(double TimeS, double SeaScale = 1.0);
FSail SolveSail(const FVector& Forward, const FVector& RelativeAir, const FHelm& Helm);
FLoads CalculateLoads(const FRigidState& State, const FHelm& Helm, double TimeS, double SeaScale = 1.0);
}
