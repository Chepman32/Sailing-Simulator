#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SailingVoyageSound.generated.h"

class ASailingYachtPawn;
class UAudioComponent;
class UMediaPlayer;
class UMediaSoundComponent;
class USoundWaveProcedural;

enum class ESailingCue : uint8 { Horn, Bell, Flare, Splash };

UCLASS()
class USailingVoyageSound : public UActorComponent
{
    GENERATED_BODY()
public:
    void Toggle();
    void Tune(int Direction);
    void Cue(ESailingCue Kind);
    void Update(const ASailingYachtPawn& Yacht);
    void EndPlay(const EEndPlayReason::Type Reason) override;
    bool Enabled() const { return bEnabled; }
    int Station() const { return Selected; }
    FString StationLabel() const;
    bool StreamPlaying() const;
    int64 SamplesWritten() const { return SampleIndex; }

private:
    void StartSpeaker();
    void ApplyStation();
    void TryServer();
    void FillBlock(float Engine, float Speed, float Weather, float Depth);
    UPROPERTY() TObjectPtr<USoundWaveProcedural> Wave;
    UPROPERTY() TObjectPtr<UAudioComponent> Speaker;
    UPROPERTY() TObjectPtr<UMediaPlayer> Media;
    UPROPERTY() TObjectPtr<UMediaSoundComponent> Radio;
    TArray<int16> PCM;
    int Selected = -1, Server = 0;
    int64 SampleIndex = 0, HornStart = -1000000, BellStart = -1000000, BurstStart = -1000000, SongStart = 0;
    double ConnectingSince = 0, EnginePhase = 0;
    float LowNoise = 0, SeaNoise = 0;
    uint32 NoiseSeed = 134597;
    bool bEnabled = false, bExhausted = false, bStreamStarted = false;
};
