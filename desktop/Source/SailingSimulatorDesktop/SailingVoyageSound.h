#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/TimerHandle.h"
#include "SailingVoyageSound.generated.h"

class ASailingYachtPawn;
class ASailingJetSki;
class UAudioComponent;
class UMediaPlayer;
class UMediaSoundComponent;
class USoundWave;
class USoundWaveProcedural;
#if PLATFORM_MAC
class FSailingMusicLibrary;
#endif

enum class ESailingCue : uint8 { Horn, Bell, Flare, Splash };
enum class ESailingAudioBus : uint8 { Music, World, Engine, Count };

UCLASS()
class USailingVoyageSound : public UActorComponent
{
    GENERATED_BODY()
public:
    USailingVoyageSound();
    void LoadPreferences();
    void SavePreferences() const;
    void SetEnabled(bool bEnable);
    void Toggle();
    float Volume(ESailingAudioBus Bus) const { return Levels[int32(Bus)]; }
    void SetVolume(ESailingAudioBus Bus, float Level);
#if PLATFORM_MAC
    FSailingMusicLibrary& MusicLibrary() const { return *LocalMusic; }
    bool PlayLocalTrack(int32 Track);
    void StopLocalMusic();
    bool IsLocalStation() const;
#endif
    void Tune(int Direction);
    void Cue(ESailingCue Kind);
    void WhaleImpact(FVector Position, float Force);
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
    enum class EFootstepSample : uint8 { Deck, Ground, Water, Sand, Count };
    struct FFootstepBank
    {
        int32 First = 0;
        int32 Count = 0;
        int32 Last = INDEX_NONE;
        TArray<int32, TInlineAllocator<10>> Remaining;
    };
    struct FFootstepPlayback
    {
        float Gain = 0.f;
        float FadeDelay = -1.f;
        float FadeSeconds = 0.f;
    };
    static constexpr int32 FootstepVoiceCount = 6;

    void StartSpeaker();
    void Update(const ASailingYachtPawn& Yacht, float DeltaTime);
    void UpdateUnderwater(float Depth, float DeltaTime);
    void UpdateJetSki(const ASailingJetSki* Ski);
    void UpdateFootsteps(const ASailingYachtPawn& Yacht, float DeltaTime);
    void PlayFootstep(EFootstepSample Sample, float Gain, float Pitch,
                      float LowPass = 0.f, float HighPass = 0.f, float MaxSeconds = 0.f);
    void UpdateVoiceVolumes();
    void ApplyStation();
    void TryServer();
    UAudioComponent* MakeVoice(USoundWave* Recording, FName Name = NAME_None);
    void PlayWhaleImpact();
    void FillBlock(float Speed, float Weather, float Depth);
    UPROPERTY() TObjectPtr<USoundWaveProcedural> Wave;
    UPROPERTY() TObjectPtr<UAudioComponent> Speaker;
    UPROPERTY() TObjectPtr<UMediaPlayer> Media;
    UPROPERTY() TObjectPtr<UMediaSoundComponent> Radio;
    UPROPERTY() TObjectPtr<USoundWave> DieselRecording;
    UPROPERTY() TObjectPtr<USoundWave> HornRecording;
    UPROPERTY() TObjectPtr<USoundWave> BellRecording;
    UPROPERTY() TObjectPtr<USoundWave> WhaleRecording;
    UPROPERTY() TObjectPtr<USoundWave> UnderwaterRecording;
    UPROPERTY() TObjectPtr<USoundWave> JetSkiRecording;
    UPROPERTY() TArray<TObjectPtr<USoundWave>> UnderwaterCalls;
    UPROPERTY() TArray<TObjectPtr<USoundWave>> FootstepRecordings;
    UPROPERTY() TObjectPtr<UAudioComponent> Diesel;
    UPROPERTY() TObjectPtr<UAudioComponent> Horn;
    UPROPERTY() TObjectPtr<UAudioComponent> Bell;
    UPROPERTY() TObjectPtr<UAudioComponent> Whale;
    UPROPERTY() TObjectPtr<UAudioComponent> UnderwaterBed;
    UPROPERTY() TObjectPtr<UAudioComponent> UnderwaterWhale;
    UPROPERTY() TObjectPtr<UAudioComponent> JetSkiVoice;
    UPROPERTY() TArray<TObjectPtr<UAudioComponent>> FootstepVoices;
#if PLATFORM_MAC
    TSharedPtr<FSailingMusicLibrary> LocalMusic;
#endif
    FTimerHandle WhaleDelay;
    TArray<int16> PCM;
    int Selected = -1, Server = 0;
    int64 SampleIndex = 0, BurstStart = -1000000, SongStart = 0;
    double ConnectingSince = 0;
    double NextSpeakerStart = 0;
    float LowNoise = 0, SeaNoise = 0;
    float ImmersionGain = 0, NextCallIn = 0;
    float Levels[int32(ESailingAudioBus::Count)] = {1.f, 1.f, 1.f};
    float DieselGain = 0, JetSkiGain = 0, WhaleGain = 0;
    int32 NextWhaleCall = 0;
    int32 NextFootstepVoice = 0;
    FRandomStream FootstepRandom;
    FFootstepBank FootstepBanks[int32(EFootstepSample::Count)];
    FFootstepPlayback FootstepPlayback[FootstepVoiceCount];
    uint32 NoiseSeed = 134597;
    uint32 LastFootfall = 0;
    bool bEnabled = false, bExhausted = false, bStreamStarted = false, bEngineAudible = true;
    bool bUnderwater = false;
};
