#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SailingVoyageSound.generated.h"

class ASailingYachtPawn;
class UAudioComponent;
class UMediaPlayer;
class UMediaSoundComponent;
class USoundWave;
class USoundWaveProcedural;

enum class ESailingCue : uint8 { Horn, Bell, Flare, Splash };

UCLASS()
class USailingVoyageSound : public UActorComponent
{
    GENERATED_BODY()
public:
    USailingVoyageSound();
    void SetEnabled(bool bEnable);
    void Toggle() { SetEnabled(!bEnabled); }
    void Tune(int Direction);
    void Cue(ESailingCue Kind);
    void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTick) override;
    void EndPlay(const EEndPlayReason::Type Reason) override;
    bool Enabled() const { return bEnabled; }
    bool EngineAudible() const { return bEngineAudible; }
    void ToggleEngineAudio() { bEngineAudible = !bEngineAudible; }
    int Station() const { return Selected; }
    FString StationLabel() const;
    bool StreamPlaying() const;
    int64 SamplesWritten() const { return SampleIndex; }

private:
    void StartSpeaker();
    void Update(const ASailingYachtPawn& Yacht);
    void ApplyStation();
    void TryServer();
    UAudioComponent* MakeVoice(USoundWave* Recording);
    void FillBlock(float Speed, float Weather, float Depth);
    UPROPERTY() TObjectPtr<USoundWaveProcedural> Wave;
    UPROPERTY() TObjectPtr<UAudioComponent> Speaker;
    UPROPERTY() TObjectPtr<UMediaPlayer> Media;
    UPROPERTY() TObjectPtr<UMediaSoundComponent> Radio;
    UPROPERTY() TObjectPtr<USoundWave> DieselRecording;
    UPROPERTY() TObjectPtr<USoundWave> HornRecording;
    UPROPERTY() TObjectPtr<USoundWave> BellRecording;
    UPROPERTY() TObjectPtr<UAudioComponent> Diesel;
    UPROPERTY() TObjectPtr<UAudioComponent> Horn;
    UPROPERTY() TObjectPtr<UAudioComponent> Bell;
    TArray<int16> PCM;
    int Selected = -1, Server = 0;
    int64 SampleIndex = 0, BurstStart = -1000000, SongStart = 0;
    double ConnectingSince = 0;
    double NextSpeakerStart = 0;
    float LowNoise = 0, SeaNoise = 0;
    uint32 NoiseSeed = 134597;
    bool bEnabled = false, bExhausted = false, bStreamStarted = false, bEngineAudible = true;
};
