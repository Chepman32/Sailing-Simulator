#pragma once

#include "Engine/GameViewportClient.h"
#include "SailingViewportClient.generated.h"

class ACameraActor;
UCLASS()
class USailingViewportClient : public UGameViewportClient
{
    GENERATED_BODY()

public:
    void Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice) override;
    void FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews) override;
    float FramesPerSecond() const { return DisplayFPS; }

private:
    void RecordBenchmark(FIntPoint Size, double Now);
    bool PrepareDiveBenchmark();
    bool PrepareAlongsideBenchmark();
    void UpdateWaterView();
    FString WaterView, WaterFrames;
    TWeakObjectPtr<ACameraActor> WaterCamera;
    float WaterViewStart = -1, EntryTime = -1;
    int32 CapturedFrames = 0, WaterFrameCount = 150;
    bool bStartAlongside = false;
    FIntPoint PreviousSize = FIntPoint::ZeroValue;
    float ReconstructionScale = 1;
    double GpuTotalMs = 0;
    int32 GpuSamples = 0;
    double DisplaySampleStart = 0;
    uint64 FirstDisplayFrame = 0;
    float DisplayFPS = 0;

    FString BenchmarkPath;
    TArray<double> FrameTimesMs;
    double BenchmarkStart = 0;
    double PreviousFrame = 0;
    int32 BenchmarkFrames = 0;
    enum class EDiveReplay : uint8 { None, Leave, Submerge, Settle };
    EDiveReplay DiveReplay = EDiveReplay::None;
    double DiveInputStart = 0;
};
