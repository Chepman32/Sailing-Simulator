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
}
