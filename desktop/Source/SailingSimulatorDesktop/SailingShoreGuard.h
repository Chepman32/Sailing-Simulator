#pragma once

#include "SailingPhysics.h"

class UWorld;

namespace Sailing
{
inline constexpr double HullHalfLengthM = 5.5;
inline constexpr double HullHalfBeamM = 2.7;

struct FShoreContact
{
    double ClearanceM = TNumericLimits<double>::Max();
    FVector2D Seaward = FVector2D::ZeroVector;
    FVector2D HullOffsetM = FVector2D::ZeroVector;
};

// Horizontal sections of island shelves and rocks at a safe keel depth.
// The game thread builds it once. Fixed-step physics only reads these polygons.
class FShoreMap
{
public:
    explicit FShoreMap(UWorld& World);
    FShoreContact AtHull(FVector2D CenterM, FVector2D Bow) const;
    bool CorridorClear(FVector2D StartM, FVector2D EndM, double MarginM) const;

private:
    struct FEdge
    {
        FVector2D Start, Delta;
        double InverseLengthSquared;
    };
    struct FBarrier
    {
        FBox2D Bounds{ForceInit};
        TArray<FEdge> Edges;
    };
    TArray<FBarrier> Barriers;
};

struct FShoreGuard
{
    // Returns true when the hull has failed to clear the shallows under its own motion.
    bool Constrain(const FShoreMap& Map, const FRigidState& Boat, const FHelm& Helm, double Dt, FLoads& Loads);
private:
    int32 PassingSide = 0;
    double GroundedSeconds = 0;
    double StalledSeconds = 0;
};
}
