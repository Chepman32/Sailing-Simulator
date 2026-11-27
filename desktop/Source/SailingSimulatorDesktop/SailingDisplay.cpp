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
    constexpr int32 Heights[] = {720, 1080, 1440, 2160};
    FIntPoint Tiers[] = {{0,0}, {0,0}, {0,0}, {0,0}};
    for (const FIntPoint Size : Reported)
    {
        const int32 Long = Size.GetMax(), Short = Size.GetMin();
        if (Long >= 1280 && Short >= 720 && Long <= 3840 && Short <= 2160 &&
            Size.X <= Native.X && Size.Y <= Native.Y)
        {
            const int32 Tier = Short < 900 ? 0 : Short < 1260 ? 1 : Short < 1800 ? 2 : 3;
            FIntPoint& Pick = Tiers[Tier];
            // Pick one mode near each standard height, keeping the wider mode on a tie.
            const int32 Target = Heights[Tier];
            const int32 Error = FMath::Abs(Short - Target);
            const int32 OldError = FMath::Abs(Pick.GetMin() - Target);
            if (Error < OldError || (Error == OldError && Size.GetMax() > Pick.GetMax())) Pick = Size;
        }
    }
    TArray<FIntPoint> Sizes;
    for (FIntPoint Size : Tiers)
        if (Size.GetMin() > 0) Sizes.Add(Size);
    return Sizes;
}

float RenderResolutionFraction(FIntPoint Target, FIntPoint Output)
{
    if (Target.GetMin() <= 0 || Output.GetMin() <= 0) return 1.f;
    // Keep the fullscreen projection and constrain both render dimensions on a differently shaped display.
    return FMath::Min3(1.f, float(Target.X) / Output.X, float(Target.Y) / Output.Y);
}

bool FShadingBudget::AppliesTo(FIntPoint Output)
{
    return Output.GetMin() > 0 && int64(Output.X) * Output.Y >= 2560 * 1440;
}

void FShadingBudget::Reset(FIntPoint Output)
{
    const double Pixels = FMath::Max(1., double(Output.X) * Output.Y);
    NormalFloor = FMath::Min(1., FMath::Sqrt(960. * 540. / Pixels));
    EmergencyFloor = FMath::Min(1., FMath::Sqrt(832. * 468. / Pixels));
    InitialFraction = FMath::Min(1., FMath::Sqrt(1280. * 720. / Pixels));
    Fraction = InitialFraction;
    Samples = FastWindows = SlowWindows = 0;
    PeakMs = 0.f;
}

float FShadingBudget::Update(float GpuMs)
{
    if (!FMath::IsFinite(GpuMs) || GpuMs <= 0.f) return Fraction;
    PeakMs = FMath::Max(PeakMs, GpuMs);
    // Leave room for presentation, new visible surfaces and GPU timing latency.
    // Six frames also allow in-flight work at the old size to drain.
    if (++Samples < 6) return Fraction;
    constexpr float TargetMs = 22.f;
    // Stay above the normal floor for isolated stalls. A sustained costly view
    // can use the emergency range before its frames start missing 30 Hz.
    SlowWindows = PeakMs > 26.f ? FMath::Min(SlowWindows + 1, 2) : 0;
    if (PeakMs > TargetMs * 1.12f)
    {
        const float Floor = SlowWindows == 2 ? EmergencyFloor : FMath::Min(Fraction, NormalFloor);
        Fraction = FMath::Max(Floor, FMath::FloorToFloat(64.f * Fraction *
            FMath::Clamp(FMath::Sqrt(TargetMs / PeakMs), .72f, .98f)) / 64.f);
        FastWindows = 0;
    }
    else if (PeakMs < TargetMs * .86f)
    {
        if (++FastWindows >= 5)
        {
            Fraction = FMath::Min(1.f, Fraction + 1.f / 64.f);
            FastWindows = 0;
        }
    }
    else FastWindows = 0;
    Samples = 0;
    PeakMs = 0.f;
    return Fraction;
}

float FShadingBudget::AllocationFraction() const
{
    // Keep enough target space to recover after an orbit or a storm. Crossing
    // the normal floor must not repeatedly reallocate the scene textures.
    return FMath::CeilToFloat(8.f * FMath::Max(Fraction, InitialFraction)) / 8.f;
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
    if (Display.Desktop.GetMin() > 0)
    {
        Display.Sizes.Remove(Display.Desktop);
        if (Display.Sizes.Num() > 3) Display.Sizes.RemoveAt(0);
        Display.Sizes.Add(Display.Desktop);
    }
    return Display;
}
}
