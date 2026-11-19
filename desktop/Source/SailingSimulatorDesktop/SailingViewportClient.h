#pragma once

#include "Engine/GameViewportClient.h"
#include "SailingViewportClient.generated.h"

UCLASS()
class USailingViewportClient : public UGameViewportClient
{
    GENERATED_BODY()

public:
    void Init(FWorldContext& WorldContext, UGameInstance* Instance, bool bCreateAudioDevice) override;
    void FinalizeViews(FSceneViewFamily* Family, const TMap<ULocalPlayer*, FSceneView*>& PlayerViews) override;

private:
    void RecordBenchmark(FIntPoint Size);
    bool PrepareDiveBenchmark();
    FIntPoint PreviousSize = FIntPoint::ZeroValue;
    float ReconstructionScale = 1;
    double GpuTotalMs = 0;
    int32 GpuSamples = 0;

    FString BenchmarkPath;
    TArray<double> FrameTimesMs;
    double BenchmarkStart = 0;
    double PreviousFrame = 0;
    int32 BenchmarkFrames = 0;
    enum class EDiveReplay : uint8 { None, Leave, Submerge, Settle };
    EDiveReplay DiveReplay = EDiveReplay::None;
    double DiveInputStart = 0;
};
