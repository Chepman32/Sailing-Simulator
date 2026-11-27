#pragma once

#include "CoreMinimal.h"

class FViewport;
class SWindow;

namespace Sailing
{
struct FDisplayModes
{
    FString MonitorID;
    int32 MonitorIndex = INDEX_NONE;
    FIntPoint Desktop = FIntPoint::ZeroValue;
    TArray<FIntPoint> Sizes;
};

TArray<FIntPoint> SelectableResolutions(TConstArrayView<FIntPoint> Reported, FIntPoint Native);
float RenderResolutionFraction(FIntPoint Target, FIntPoint Output);
FDisplayModes ReadDisplayModes(const FViewport& Viewport, const SWindow& Window);

// Controls the primary shading grid. The selected output grid stays fixed.
class FShadingBudget
{
public:
    static bool AppliesTo(FIntPoint Output);
    void Reset(FIntPoint Output);
    float Update(float GpuMs);
    float AllocationFraction() const;
private:
    float Fraction = 1.f, InitialFraction = 1.f;
    float NormalFloor = 1.f, EmergencyFloor = 1.f, PeakMs = 0.f;
    int32 Samples = 0, FastWindows = 0, SlowWindows = 0;
};
}
