#pragma once

#include "CoreMinimal.h"
#include "Math/Float16Color.h"

namespace Sailing
{
inline constexpr double CruisingSpeedScale = 1.5;
inline constexpr double MassKg = 9800.0;
inline constexpr double KnotsPerMps = 1.94384449;
inline constexpr double MaxRudderDegrees = 32.0;
inline constexpr int32 SeaWaveCount = 22;
inline constexpr float StormSeaScale = 3.9f;
inline constexpr float HurricaneSeaScale = 4.5f;

struct FSeaFrame
{
    float TimeS = 0.0f;
    float Scale = 1.0f;
};

struct FSeaSample
{
    double HeightM = 0.0;
    FVector2D Gradient = FVector2D::ZeroVector;
    FVector VelocityMps = FVector::ZeroVector; // Water particle velocity at the requested depth.
    double SurfaceRiseMps = 0.; // Height rate at a fixed horizontal position.
    double Compression = 0.; // Convergence of the horizontal wave orbits at the surface.
    double SwellRiseMps = 0.; // Long-wave surface rise along a hull station's course.
    double SwellAccelerationMps2 = 0.; // Long-wave vertical acceleration along a hull station's course.
};

// Find the nearby shore-breaking crest, starting at a point on the island shelf.
// The position is in world metres and the normal points inland.
struct FShoreLip
{
    FVector PositionM;
    FVector2D Shoreward;
    float Aeration;
    float SpeedMps;
};
bool FindShoreLip(FVector2D ProbeM, FSeaFrame Frame, FShoreLip& Out);

struct FBoatWake
{
    FVector2D SternM;
    FVector2D Forward;
    double SpeedMps;
    double HullBias = 0; // Starboard minus port wave power, divided by their sum, in the travel frame.
    static FBoatWake FromMotion(FVector2D CenterM, FVector2D Bow, FVector2D VelocityMps, double YawRadPerSec=0);
    double HeightAt(FVector2D XYm) const;
};

struct FWakeHistory
{
    static constexpr int32 Count = 8;
    FLinearColor Marks[Count] = {}; // Stern midpoint in metres, birth time, surge speed.
    FVector2f Directions[Count] = {};
    float HullBias[Count] = {};
    uint32 Revision = 0;
    void Record(const FBoatWake& Wake, float TimeS);
    FSeaSample At(FVector2D XYm, double TimeS) const;

private:
    int32 Next = 0;
    float NextTime = 0;
    FVector2D PreviousStern = FVector2D::ZeroVector;
    bool bHasPosition = false;
};

struct FWaterImpacts
{
    static constexpr int32 Count = 4;
    // Encoded as material vectors: origin in metres, birth time, crest height.
    FLinearColor Rings[Count] = {};
    // One persistent contact per animal, independent of frequent bow impacts.
    FLinearColor WhalePrints[2] = {FLinearColor::Transparent, FLinearColor::Transparent};
    void Emit(FVector2D CenterM, float TimeS, float HeightM);
    FSeaSample At(FVector2D XYm, double TimeS, double DepthM = 0) const;
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
    double WorkingAreaFraction = 1.0;
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

FSeaSample SampleSea(FVector2D XYm, double TimeS, double DepthM = 0.0, double Scale = 1.0, bool bCoralPass = false);
double SeaHeight(FVector2D XYm, FSeaFrame Frame, bool bCoralPass);
// Two rows per surveyed beach, holding phase, shoaling and depth, then their spatial derivatives.
inline constexpr int32 SurfProfileWidth = 97;
TConstArrayView<FLinearColor> SurfProfileTexels();
inline constexpr int32 RockTileWidth = 128, RockWashFrames = 32;
inline constexpr int32 RockTileCount = 0
#define SURF_TILE(...) +1
#include "CoralSurfTiles.inl"
#undef SURF_TILE
;
TConstArrayView<uint8> RockWashTexels();
TConstArrayView<FFloat16Color> RockSurfTexels();
double SeaWaveAmplitude(int32 Index, double Scale);
FLinearColor SeaWaveParameter(int32 Index, FSeaFrame Frame);
double SignificantWaveHeight(double Scale);
float AdvanceSeaScale(float Current, float Target, float DeltaSeconds);
FVector TrueWind(double TimeS, double SeaScale = 1.0);
FSail SolveSail(const FVector& Forward, const FVector& RelativeAir, const FHelm& Helm);
FLoads CalculateLoads(const FRigidState& State, const FHelm& Helm, double TimeS, double SeaScale = 1.0,
                      bool bCoralPass = false, const FWaterImpacts* Impacts = nullptr, const FWakeHistory* Wake = nullptr);
}
