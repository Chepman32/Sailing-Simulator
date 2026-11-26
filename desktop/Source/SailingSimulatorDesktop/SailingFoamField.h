#pragma once

#include "CoreMinimal.h"
#include "Containers/StaticArray.h"

namespace Sailing
{
struct FFoamPose
{
    FVector2D CenterM, Bow;
    float PortMps, StarboardMps, Thrust;
    bool bWaterJet = false;
};

class FFoamField
{
public:
    static constexpr int32 Size = 256;
    static constexpr float CellM = .45f;
    static constexpr float Metres = Size*CellM;
    static constexpr float Interval = .125f;
    // A teleport starts a fresh field. Ordinary turns keep the old footprint.
    bool Record(const FFoamPose& Pose, float Now);
    void BreakAtBow(FVector2D OriginM, FVector2D Bow, int32 Side, float ClosingMps, FVector2D DriftMps, float Now);
    void Rasterize(TArray<FColor>& Pixels) const;
    FVector2D Center() const;
    static int32 Texel(int32 X, int32 Y) { return (Y & (Size-1))*Size + (X & (Size-1)); }
private:
    static constexpr int32 Capacity = 176;
    struct FMark { FFoamPose Pose; float Time; };
    struct FBreak { FVector2D Origin, Bow, Drift; float Side, Energy, Born; };
    // Two bows can each strike once per 1.15 s. Retain all eight seconds of wash.
    TStaticArray<FBreak,16> Breaks{};
    int32 NextBreak = 0;
    FMark History[Capacity]{};
    FMark Head{};
    int32 Next = 0, Count = 0;
    float NextTime = 0;
};
}
