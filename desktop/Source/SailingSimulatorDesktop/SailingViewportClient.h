#pragma once

#include "Engine/GameViewportClient.h"
#include "SailingDisplay.h"
#include "SailingViewportClient.generated.h"

class ACameraActor;
class SWidget;
UCLASS()
class USailingViewportClient : public UGameViewportClient
{
    GENERATED_BODY()

public:
    void Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice) override;
    void DetachViewportClient() override;
    void FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews) override;
    float FramesPerSecond() const { return DisplayFPS; }
    FIntPoint RenderResolution() const { return RequestedResolution; }
    void SetRenderResolution(FIntPoint Size);
    bool OffersShadingBudget() const;
    bool UsesNativeShading() const { return bNativeShading; }
    void SetNativeShading(bool bNative);
    void SetUltra(bool bEnabled);

private:
    void InitializeDisplay();
    void ApplyRenderResolution();
    FIntPoint RequestedResolution = FIntPoint::ZeroValue;
    Sailing::FShadingBudget ShadingBudget;
    FIntPoint BudgetOutput = FIntPoint::ZeroValue;
    float FixedShadingFraction = 1.f;
    bool bUltra = false, bNativeShading = false;
    void ShowStartupOverlay();
    void RemoveStartupOverlay();
    TSharedPtr<SWidget> StartupOverlay;
    bool bSubmittedStartupFrame = false;

    void RecordBenchmark(FIntPoint Size, double Now);
    bool PrepareDiveBenchmark();
    bool PrepareAlongsideBenchmark();
    void UpdateWaterView();
    FString WaterView, WaterFrames, CaptureTimes;
    TWeakObjectPtr<ACameraActor> WaterCamera;
    float WaterViewStart = -1, EntryTime = -1;
    int32 CapturedFrames = 0, WaterFrameCount = 150;
    bool bCaptureJpeg = false;
    bool bReplayFlareFired = false;
    bool bStartAlongside = false;
#if PLATFORM_MAC
    bool bActivatePreview = false;
    bool bArmBackgroundIdle = false;
#endif
    FIntPoint PreviousSize = FIntPoint::ZeroValue;
    float ReconstructionScale = 1;
    double GpuTotalMs = 0;
    int32 GpuSamples = 0;
    double DisplaySampleStart = 0;
    uint64 FirstDisplayFrame = 0;
    float DisplayFPS = 0;

    FString BenchmarkPath;
    TArray<double> FrameTimesMs;
    TArray<FVector4f> ThreadTimesMs;
    double ShadingFractionSum=0, OutputFractionSum=0;
    double BenchmarkStart = 0;
    double PreviousFrame = 0;
    int32 BenchmarkFrames = 0, MeasuredFrameCount = 600;
    enum class EDiveReplay : uint8 { None, Leave, Submerge, Settle };
    EDiveReplay DiveReplay = EDiveReplay::None;
    double DiveInputStart = 0;
};
