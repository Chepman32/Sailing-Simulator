#include "SailingViewportClient.h"

#include "DynamicRHI.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "SceneView.h"
#include "InputKeyEventArgs.h"
#include "SailingExplorer.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "UnrealClient.h"

void USailingViewportClient::Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice)
{
    Super::Init(WorldContext, Instance, bCreateAudioDevice);
    FParse::Value(FCommandLine::Get(), TEXT("SailingBenchmark="), BenchmarkPath);
    if (!BenchmarkPath.IsEmpty() && FParse::Param(FCommandLine::Get(), TEXT("SailingBenchmarkDive")))
        DiveReplay = EDiveReplay::Leave;
}

void USailingViewportClient::FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews)
{
    Super::FinalizeViews(Family, PlayerViews);
    if (PlayerViews.IsEmpty() || !Family->RenderTarget) return;
    const FIntPoint Size = Family->RenderTarget->GetSizeXY();
    if (!BenchmarkPath.IsEmpty()) RecordBenchmark(Size);
    if (Size != PreviousSize)
    {
        PreviousSize = Size;
        ReconstructionScale = 1;
        GpuTotalMs = 0;
        GpuSamples = 0;
    }
    constexpr double ReferencePixels = 1440.0 * 900;
    const double Pixels = double(Size.X) * Size.Y;
    if (Pixels <= ReferencePixels || GIsHighResScreenshot || !Family->SupportsScreenPercentage()) return;

    // Primary dynamic resolution scales shading. On a Retina display TSR and the
    // following passes can exceed 30 ms even at the primary floor. Scale their
    // output only after sustained GPU pressure; the HUD is drawn at display size.
    const double GpuMs = FPlatformTime::ToMilliseconds(RHIGetGPUFrameCycles());
    if (GpuMs > 0)
    {
        GpuTotalMs += FMath::Min(GpuMs, 100.0);
        if (++GpuSamples == 45)
        {
            const double MeanMs = GpuTotalMs / GpuSamples;
            const float Floor = FMath::Sqrt(ReferencePixels / Pixels);
            if (MeanMs > 29)
            {
                ReconstructionScale = FMath::Max<float>(Floor, ReconstructionScale * FMath::Sqrt(24.0 / MeanMs));
            }
            else if (MeanMs < 18)
            {
                ReconstructionScale = FMath::Min(1.f, ReconstructionScale + .06f);
            }
            GpuTotalMs = 0;
            GpuSamples = 0;
        }
    }
    Family->SecondaryViewFraction = FMath::Min(Family->SecondaryViewFraction, ReconstructionScale);
}

void USailingViewportClient::RecordBenchmark(FIntPoint Size)
{
    if (DiveReplay != EDiveReplay::None && !PrepareDiveBenchmark()) return;
    const double Now = FPlatformTime::Seconds();
    if (BenchmarkFrames == 0) BenchmarkStart = Now;
    const double FrameMs = (Now - PreviousFrame) * 1000.0;
    PreviousFrame = Now;
    if (++BenchmarkFrames <= 120 || Now - BenchmarkStart < 5.0) return;
    FrameTimesMs.Add(FrameMs);
    if (FrameTimesMs.Num() < 600) return;

    FrameTimesMs.Sort();
    double TotalMs = 0;
    int32 SlowFrames = 0;
    for (double Ms : FrameTimesMs)
    {
        TotalMs += Ms;
        if (Ms > 1000.0 / 30.0) ++SlowFrames;
    }
    const int32 Count = FrameTimesMs.Num();
    const FString Result = FString::Printf(
        TEXT("width,height,frames,average_fps,p95_frame_ms,frames_over_33_33_ms\n%d,%d,%d,%.2f,%.2f,%d\n"),
        Size.X, Size.Y, Count, 1000.0 * Count / TotalMs, FrameTimesMs[FMath::CeilToInt(.95 * Count) - 1], SlowFrames);
    const bool bSaved = FFileHelper::SaveStringToFile(Result, *BenchmarkPath);
    BenchmarkPath.Reset();
    FPlatformMisc::RequestExitWithStatus(false, bSaved ? 0 : 1, TEXT("SailingBenchmark"));
}

bool USailingViewportClient::PrepareDiveBenchmark()
{
    auto* Player = GetWorld() ? Cast<ASailingPlayerController>(GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!Yacht) return false;
    const auto Key = [&](FKey Which, bool bDown)
    {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Which, bDown ? IE_Pressed : IE_Released, bDown ? 1.f : 0.f));
    };
    if (DiveReplay == EDiveReplay::Leave)
    {
        Key(EKeys::T, true);
        Key(EKeys::T, false);
        DiveReplay = EDiveReplay::Submerge;
    }
    else if (DiveReplay == EDiveReplay::Submerge && Yacht->Explorer().Mode() == ESkipperMode::Swim)
    {
        Key(EKeys::C, true);
        DiveInputStart = GetWorld()->GetTimeSeconds();
        DiveReplay = EDiveReplay::Settle;
    }
    else if (DiveReplay == EDiveReplay::Settle && GetWorld()->GetTimeSeconds() - DiveInputStart > 2.4)
    {
        Key(EKeys::C, false);
        DiveReplay = EDiveReplay::None;
    }
    return DiveReplay == EDiveReplay::None;
}
