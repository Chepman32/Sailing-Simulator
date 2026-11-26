#include "SailingDisplay.h"

#include "Framework/Application/SlateApplication.h"
#include "GenericPlatform/GenericApplication.h"
#include "Kismet/KismetSystemLibrary.h"
#include "UnrealClient.h"
#include "Widgets/SWindow.h"
#if PLATFORM_MAC
#include "Mac/MacSystemIncludes.h"
#include <IOKit/graphics/IOGraphicsTypes.h>
#elif PLATFORM_WINDOWS
#include "Windows/WindowsHWrapper.h"
#endif

namespace Sailing
{
TArray<FIntPoint> SelectableResolutions(TConstArrayView<FIntPoint> Reported, FIntPoint Native)
{
    TArray<FIntPoint> Sizes;
    for (const FIntPoint Size : Reported)
    {
        const int32 Long = Size.GetMax(), Short = Size.GetMin();
        if (Long >= 1280 && Short >= 720 && Long <= 3840 && Short <= 2160 &&
            Size.X <= Native.X && Size.Y <= Native.Y)
            Sizes.AddUnique(Size);
    }
    Sizes.Sort([](FIntPoint A,FIntPoint B) {
        return A.X == B.X ? A.Y < B.Y : A.X < B.X;
    });
    return Sizes;
}

float RenderResolutionFraction(FIntPoint Target, FIntPoint Output)
{
    if (Target.GetMin() <= 0 || Output.GetMin() <= 0) return 1.f;
    // Keep the fullscreen projection and constrain both render dimensions on a differently shaped display.
    return FMath::Min3(1.f, float(Target.X) / Output.X, float(Target.Y) / Output.Y);
}

FDisplayModes ReadDisplayModes(const FViewport& Viewport, const SWindow& Window)
{
    FDisplayModes Display;
    const auto& Monitors = FSlateApplication::Get().GetCachedDisplayMetricsByRef().MonitorInfo;
    FSlateRect ScreenRect = Window.GetFullScreenInfo();
    const bool HasScreenRect = ScreenRect.Right > ScreenRect.Left && ScreenRect.Bottom > ScreenRect.Top;
    Display.MonitorIndex = Viewport.GetCurrentMonitorIndex();
    if (!HasScreenRect && !Monitors.IsValidIndex(Display.MonitorIndex))
        Display.MonitorIndex = Monitors.IndexOfByPredicate([](const FMonitorInfo& Monitor) { return Monitor.bIsPrimary; });
    if (!Monitors.IsValidIndex(Display.MonitorIndex))
    {
        // The OS has already chosen the screen for a straddling window. A notch
        // can offset the cached monitor origin from that screen's actual origin.
        double BestDistance = TNumericLimits<double>::Max();
        for (int32 Index=0; Index<Monitors.Num(); ++Index)
        {
            const auto& R = Monitors[Index].DisplayRect;
            const double Distance = FMath::Square(ScreenRect.Left-R.Left) + FMath::Square(ScreenRect.Top-R.Top);
            if (Distance < BestDistance)
            {
                BestDistance = Distance;
                Display.MonitorIndex = Index;
            }
        }
    }
    if (!Monitors.IsValidIndex(Display.MonitorIndex)) return Display;
    const auto& Monitor = Monitors[Display.MonitorIndex];
    Display.MonitorID = Monitor.ID;
    if (!HasScreenRect)
    {
        // Offscreen or transitioning windows can have no backing screen for a frame.
        const auto& R = Monitor.DisplayRect;
#if PLATFORM_MAC
        // In UE's macOS monitor cache the last two fields hold extents.
        ScreenRect = FSlateRect(R.Left,R.Top,R.Left+R.Right,R.Top+R.Bottom);
#else
        ScreenRect = FSlateRect(R.Left,R.Top,R.Right,R.Bottom);
#endif
    }
    Display.Desktop = {FMath::RoundToInt(ScreenRect.Right-ScreenRect.Left),FMath::RoundToInt(ScreenRect.Bottom-ScreenRect.Top)};
    FIntPoint Native(Monitor.NativeWidth,Monitor.NativeHeight);
    TArray<FIntPoint> Modes;
#if PLATFORM_MAC
    // Metal's general enumeration always queries the primary screen and returns scaled points.
    // Quartz takes the ID of this particular display and exposes the framebuffer pixels of HiDPI modes.
    const CGDirectDisplayID Screen = FCString::Strtoui64(*Monitor.ID,nullptr,10);
    const void* Keys[] = {kCGDisplayShowDuplicateLowResolutionModes};
    const void* Values[] = {kCFBooleanTrue};
    CFDictionaryRef Options = CFDictionaryCreate(nullptr,Keys,Values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    CFArrayRef All = CGDisplayCopyAllDisplayModes(Screen,Options);
    CFRelease(Options);
    if (All)
    {
        for (CFIndex Index=0; Index<CFArrayGetCount(All); ++Index)
        {
            const auto Mode = (CGDisplayModeRef)CFArrayGetValueAtIndex(All,Index);
            if (!CGDisplayModeIsUsableForDesktopGUI(Mode)) continue;
            FIntPoint Pixels(CGDisplayModeGetPixelWidth(Mode),CGDisplayModeGetPixelHeight(Mode));
            if ((Display.Desktop.X < Display.Desktop.Y) != (Pixels.X < Pixels.Y)) Swap(Pixels.X,Pixels.Y);
            Modes.Add(Pixels);
            if (CGDisplayModeGetIOFlags(Mode) & kDisplayModeNativeFlag) Native = Pixels;
        }
        CFRelease(All);
    }
#elif PLATFORM_WINDOWS
    // EDID gives the panel's native orientation even when Windows rotates the desktop.
    if ((Native.X < Native.Y) != (Display.Desktop.X < Display.Desktop.Y)) Swap(Native.X,Native.Y);
    MONITORINFOEXW Info{};
    Info.cbSize = sizeof(Info);
    if (GetMonitorInfoW(static_cast<HMONITOR>(Monitor.NativeHandle),&Info))
    {
        DEVMODEW Mode{};
        Mode.dmSize = sizeof(Mode);
        for (DWORD Index=0; EnumDisplaySettingsW(Info.szDevice,Index,&Mode); ++Index)
            Modes.Emplace(Mode.dmPelsWidth,Mode.dmPelsHeight);
    }
#else
    UKismetSystemLibrary::GetSupportedFullscreenResolutions(Modes);
#endif
    if (Native.GetMin() <= 0) Native = Display.Desktop;
    Display.Sizes = SelectableResolutions(Modes, {FMath::Min(Native.X, Display.Desktop.X), FMath::Min(Native.Y, Display.Desktop.Y)});
    if (Display.Desktop.GetMin() > 0) Display.Sizes.AddUnique(Display.Desktop);
    return Display;
}
}
