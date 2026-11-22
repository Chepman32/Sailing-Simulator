#pragma once

#include "CoreMinimal.h"
#include "GenericPlatform/GenericWindow.h"

class FViewport;
class SWindow;

namespace Sailing
{
struct FDisplayModes
{
    FString MonitorID;
    int32 MonitorIndex = INDEX_NONE;
    FIntPoint Desktop = FIntPoint::ZeroValue;
    FIntPoint WindowLimit = FIntPoint::ZeroValue;
    TArray<FIntPoint> Sizes;
    EWindowMode::Type WindowModeFor(FIntPoint Size) const
    {
        if (Size == Desktop) return EWindowMode::WindowedFullscreen;
        return Size.X <= WindowLimit.X && Size.Y <= WindowLimit.Y ? EWindowMode::Windowed : EWindowMode::Fullscreen;
    }
};

TArray<FIntPoint> SelectableResolutions(TConstArrayView<FIntPoint> Reported, FIntPoint Native);
FDisplayModes ReadDisplayModes(const FViewport& Viewport, const SWindow& Window);
}
