#pragma once

#include "CoreMinimal.h"

namespace Sailing
{
struct FFoamPose
{
    FVector2D CenterM, Bow;
    float PortMps, StarboardMps, Thrust;
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
    void Rasterize(TArray<FColor>& Pixels) const;
    FVector2D Center() const;
    static int32 Texel(int32 X, int32 Y) { return (Y & (Size-1))*Size + (X & (Size-1)); }
private:
    static constexpr int32 Capacity = 176;
    struct FMark { FFoamPose Pose; float Time; };
    FMark History[Capacity]{};
    FMark Head{};
    int32 Next = 0, Count = 0;
    float NextTime = 0;
};
}
