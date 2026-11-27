#include "SailingVoyageSound.h"

#include "Components/AudioComponent.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"
#include "MediaPlayer.h"
#include "MediaSoundComponent.h"
#include "Misc/ConfigCacheIni.h"
#include "Sound/SoundAttenuation.h"
#include "Sound/SoundWaveProcedural.h"
#include "TimerManager.h"
#include "SailingExplorer.h"
#include "SailingJetSki.h"
#include "SailingMusicLibrary.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingWeather.h"

namespace
{
constexpr int Rate = 24000, Block = 1024;
constexpr int BufferedBlocks = 5;
constexpr float RadioGain = .43f;
constexpr int32 BandStation = 3, LocalStation = 4;
const TCHAR* const SoundSection = TEXT("Sailing.Sound");
const TCHAR* const MixKeys[] = {TEXT("Music"), TEXT("World"), TEXT("Engine")};
static_assert(UE_ARRAY_COUNT(MixKeys) == int32(ESailingAudioBus::Count));
const TCHAR* const Stations[] = {TEXT("SomaFM · Groove Salad"), TEXT("SomaFM · Underground 80s"),
                                 TEXT("SomaFM · Heavyweight Reggae"), TEXT("Onboard shanty band")};
const TCHAR* const Channels[] = {TEXT("groovesalad"), TEXT("u80s"), TEXT("reggae")};
const TCHAR* const Servers[] = {TEXT("ice2"), TEXT("ice4"), TEXT("ice1"), TEXT("ice")};
float SinTone(double Phase)
{
    return FMath::Sin(UE_DOUBLE_TWO_PI * Phase);
}
} // namespace

USailingVoyageSound::USailingVoyageSound()
{
    PrimaryComponentTick.bCanEverTick = true;
    PrimaryComponentTick.bStartWithTickEnabled = false;
    PrimaryComponentTick.bTickEvenWhenPaused = true;
    static ConstructorHelpers::FObjectFinder<USoundWave> Motor(TEXT("/Game/Coastal/Audio/MarineDiesel"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Typhon(TEXT("/Game/Coastal/Audio/MarineHorn"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Chime(TEXT("/Game/Coastal/Audio/ShipBell"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Splash(TEXT("/Game/Coastal/Audio/WhaleImpact"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Ambience(TEXT("/Game/Coastal/Audio/UnderwaterAmbience"));
    static ConstructorHelpers::FObjectFinder<USoundWave> WhaleSong(TEXT("/Game/Coastal/Audio/UnderwaterWhaleSong"));
    static ConstructorHelpers::FObjectFinder<USoundWave> WhaleHaunting(TEXT("/Game/Coastal/Audio/UnderwaterWhaleHaunting"));
    static ConstructorHelpers::FObjectFinder<USoundWave> WhaleCreepy(TEXT("/Game/Coastal/Audio/UnderwaterWhaleCreepy"));
    static ConstructorHelpers::FObjectFinder<USoundWave> JetSki(TEXT("/Game/Coastal/Audio/JetSkiEngine"));
    DieselRecording = Motor.Object;
    HornRecording = Typhon.Object;
    BellRecording = Chime.Object;
    WhaleRecording = Splash.Object;
    UnderwaterRecording = Ambience.Object;
    JetSkiRecording = JetSki.Object;
    for (USoundWave* Call : {WhaleSong.Object, WhaleHaunting.Object, WhaleCreepy.Object})
        if (Call) UnderwaterCalls.Add(Call);
    const struct { const TCHAR* Name; int32 Count; } Banks[] = {
        {TEXT("Deck"), 8}, {TEXT("Ground"), 10}, {TEXT("Water"), 8}, {TEXT("Sand"), 3}
    };
    static_assert(UE_ARRAY_COUNT(Banks) == int32(EFootstepSample::Count));
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(Banks); ++Index)
    {
        FFootstepBank& Bank = FootstepBanks[Index];
        Bank.First = FootstepRecordings.Num();
        for (int32 Variant = 1; Variant <= Banks[Index].Count; ++Variant)
        {
            const FString Path = FString::Printf(TEXT("/Game/Coastal/Audio/Footstep%s%d"), Banks[Index].Name, Variant);
            const ConstructorHelpers::FObjectFinder<USoundWave> Step(*Path);
            if (Step.Object) FootstepRecordings.Add(Step.Object);
        }
        Bank.Count = FootstepRecordings.Num() - Bank.First;
    }
    FootstepRandom.GenerateNewSeed();
}

void USailingVoyageSound::LoadPreferences()
{
    bool bSoundOn = true;
    GConfig->GetBool(SoundSection, TEXT("Enabled"), bSoundOn, GGameUserSettingsIni);
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(MixKeys); ++Index)
    {
        float Level = 1.f;
        GConfig->GetFloat(SoundSection, MixKeys[Index], Level, GGameUserSettingsIni);
        Levels[Index] = FMath::IsFinite(Level) ? FMath::Clamp(Level, 0.f, 1.f) : 1.f;
    }
#if PLATFORM_MAC
    LocalMusic = MakeShared<FSailingMusicLibrary>();
#endif
    SetEnabled(bSoundOn);
    UpdateVoiceVolumes();
}

void USailingVoyageSound::SavePreferences() const
{
    GConfig->SetBool(SoundSection, TEXT("Enabled"), bEnabled, GGameUserSettingsIni);
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(MixKeys); ++Index)
        GConfig->SetFloat(SoundSection, MixKeys[Index], Levels[Index], GGameUserSettingsIni);
    GConfig->Flush(false, GGameUserSettingsIni);
}

void USailingVoyageSound::Toggle()
{
    SetEnabled(!bEnabled);
    SavePreferences();
}

void USailingVoyageSound::SetVolume(ESailingAudioBus Bus, float Level)
{
    const int32 Index = int32(Bus);
    Levels[Index] = FMath::Clamp(Level, 0.f, 1.f);
    GConfig->SetFloat(SoundSection, MixKeys[Index], Levels[Index], GGameUserSettingsIni);
    UpdateVoiceVolumes();
}

void USailingVoyageSound::UpdateVoiceVolumes()
{
    const float World = Volume(ESailingAudioBus::World), Engine = Volume(ESailingAudioBus::Engine);
    const float Music = Volume(ESailingAudioBus::Music);
    if (Horn) Horn->SetVolumeMultiplier(.50f * World);
    if (Bell) Bell->SetVolumeMultiplier(.68f * World);
    if (Whale) Whale->SetVolumeMultiplier(WhaleGain * World);
    for (int32 Index = 0; Index < FootstepVoices.Num(); ++Index)
        FootstepVoices[Index]->SetVolumeMultiplier(FootstepPlayback[Index].Gain * World);
    if (UnderwaterBed) UnderwaterBed->SetVolumeMultiplier(.48f * ImmersionGain * World);
    if (UnderwaterWhale) UnderwaterWhale->SetVolumeMultiplier(.55f * ImmersionGain * World);
    if (Diesel) Diesel->SetVolumeMultiplier(DieselGain * Engine);
    if (JetSkiVoice) JetSkiVoice->SetVolumeMultiplier(JetSkiGain * Engine);
    if (AircraftVoice) AircraftVoice->SetVolumeMultiplier(AircraftGain * World);
    if (Radio) Radio->SetVolumeMultiplier(RadioGain * Music);
#if PLATFORM_MAC
    if (LocalMusic) LocalMusic->SetVolume(.72f * Music);
#endif
}

UAudioComponent* USailingVoyageSound::MakeVoice(USoundWave* Recording, FName Name)
{
    auto* Voice = NewObject<UAudioComponent>(GetOwner(), Name);
    Voice->bAutoActivate = false;
    Voice->bAllowSpatialization = false;
    Voice->SetSound(Recording);
    Voice->RegisterComponent();
    return Voice;
}

void USailingVoyageSound::StartSpeaker()
{
    if (!Speaker)
    {
        Speaker = MakeVoice(nullptr);
        Diesel = MakeVoice(DieselRecording);
        Horn = MakeVoice(HornRecording);
        Bell = MakeVoice(BellRecording);
        for (int32 Index = 0; Index < FootstepVoiceCount; ++Index)
            FootstepVoices.Add(MakeVoice(nullptr, FName(TEXT("SkipperFootstepVoice"), Index)));
        if (WhaleRecording)
        {
            Whale = MakeVoice(WhaleRecording, TEXT("WhaleImpactVoice"));
            Whale->bAllowSpatialization = true;
            FSoundAttenuationSettings Attenuation;
            Attenuation.bSpatialize = Attenuation.bAttenuate = Attenuation.bAttenuateWithLPF = true;
            Attenuation.AttenuationShapeExtents = FVector(6500., 0., 0.);
            Attenuation.FalloffDistance = 30000.f;
            Attenuation.LPFRadiusMin = 4500.f;
            Attenuation.LPFRadiusMax = 31500.f;
            Attenuation.LPFFrequencyAtMin = 11000.f;
            Attenuation.LPFFrequencyAtMax = 1800.f;
            Whale->AdjustAttenuation(Attenuation);
        }
        PCM.SetNumUninitialized(Block);
        UpdateVoiceVolumes();
    }
    // A fresh buffer avoids the render thread draining or resetting the next
    // session's samples while the previous playback is stopping.
    Wave = NewObject<USoundWaveProcedural>(this);
    Wave->SetSampleRate(Rate);
    Wave->NumChannels = 1;
    Wave->Duration = INDEFINITELY_LOOPING_DURATION;
    Wave->SoundGroup = SOUNDGROUP_Default;
    Speaker->SetSound(Wave);
    for (int32 I = 0; I < BufferedBlocks; ++I) FillBlock(0, 1, 0);
    Speaker->Play();
    NextSpeakerStart = FPlatformTime::Seconds() + .5;
}

void USailingVoyageSound::SetEnabled(bool bEnable)
{
    if (bEnabled == bEnable) return;
    bEnabled = bEnable;
    SetComponentTickEnabled(bEnable);
    ApplyStation();
    if (bEnabled)
    {
        const auto* Player = Cast<APlayerController>(GetOwner());
        if (const auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr)
            LastFootfall = Yacht->Explorer().LastFootfall().Sequence;
        StartSpeaker();
    }
    else if (Speaker)
    {
        Speaker->Stop();
        Diesel->Stop();
        Horn->Stop();
        Bell->Stop();
        GetWorld()->GetTimerManager().ClearTimer(WhaleDelay);
        if (Whale) Whale->Stop();
        if (UnderwaterBed) UnderwaterBed->Stop();
        if (UnderwaterWhale) UnderwaterWhale->Stop();
        if (JetSkiVoice) JetSkiVoice->Stop();
        if (AircraftVoice) AircraftVoice->Stop();
        for (UAudioComponent* Voice : FootstepVoices)
            Voice->Stop();
        for (auto& Playback : FootstepPlayback)
            Playback = {};
        ImmersionGain = 0;
        bUnderwater = false;
        BurstStart = -1000000;
    }
}

void USailingVoyageSound::Tune(int Direction)
{
#if PLATFORM_MAC
    const int32 Last = LocalMusic && LocalMusic->Count() > 0 ? LocalStation : BandStation;
#else
    constexpr int32 Last = BandStation;
#endif
    if (Direction < 0) Selected = Selected <= 0 ? Last : Selected - 1;
    else Selected = Selected == Last ? -1 : Selected + 1;
    ApplyStation();
}

#if PLATFORM_MAC
bool USailingVoyageSound::IsLocalStation() const { return Selected == LocalStation; }

bool USailingVoyageSound::PlayLocalTrack(int32 Track)
{
    if (!LocalMusic || !LocalMusic->Select(Track)) return false;
    Selected = LocalStation;
    ApplyStation();
    return true;
}

void USailingVoyageSound::StopLocalMusic()
{
    if (!IsLocalStation()) return;
    Selected = -1;
    ApplyStation();
}
#endif

void USailingVoyageSound::ApplyStation()
{
    if (Media) Media->Close();
    if (Radio) Radio->Stop();
    Server = 0;
    bExhausted = bStreamStarted = false;
    SongStart = SampleIndex;
#if PLATFORM_MAC
    if (LocalMusic)
    {
        if (IsLocalStation() && LocalMusic->CurrentTrack() == INDEX_NONE) LocalMusic->Select(0);
        LocalMusic->SetActive(bEnabled && IsLocalStation());
    }
#endif
    if (!bEnabled || Selected < 0 || Selected >= UE_ARRAY_COUNT(Channels)) return;
    if (!Media)
    {
        Media = NewObject<UMediaPlayer>(this);
        Media->PlayOnOpen = true;
        Radio = NewObject<UMediaSoundComponent>(GetOwner());
        Radio->bAutoActivate = false;
        Radio->bAllowSpatialization = false;
        Radio->SetMediaPlayer(Media);
        Radio->SetVolumeMultiplier(RadioGain * Volume(ESailingAudioBus::Music));
        Radio->RegisterComponent();
    }
    Radio->Start();
    TryServer();
}

void USailingVoyageSound::TryServer()
{
    bStreamStarted = false;
    Radio->SetEnableEnvelopeFollowing(true);
    Media->Close();
    while (Server < UE_ARRAY_COUNT(Servers))
    {
        const int Candidate = Server++;
        const FString Suffix = Candidate == UE_ARRAY_COUNT(Servers) - 1 ? TEXT("") : TEXT("-128-mp3");
        const FString URL =
            FString::Printf(TEXT("https://%s.somafm.com/%s%s"), Servers[Candidate], Channels[Selected], *Suffix);
        ConnectingSince = FPlatformTime::Seconds();
        if (Media->OpenUrl(URL)) return;
    }
    bExhausted = true;
    Radio->Stop();
}

bool USailingVoyageSound::StreamPlaying() const
{
    return bStreamStarted && Media && Media->IsPlaying();
}

FString USailingVoyageSound::StationLabel() const
{
    if (Selected < 0) return TEXT("Radio off");
#if PLATFORM_MAC
    if (IsLocalStation())
    {
        const int32 Track = LocalMusic->CurrentTrack();
        FString Label = Track == INDEX_NONE ? TEXT("My music") : TEXT("My music · ") + LocalMusic->Title(Track);
        return bEnabled ? Label : Label + TEXT(" · muted");
    }
#endif
    FString Result = Stations[Selected];
    if (!bEnabled) return Result + TEXT(" · muted");
    if (Selected < UE_ARRAY_COUNT(Channels) && !StreamPlaying())
        Result += bExhausted ? TEXT(" · unavailable") : TEXT(" · tuning");
    return Result;
}

void USailingVoyageSound::Cue(ESailingCue Kind)
{
    if (!bEnabled) return;
    if (Kind == ESailingCue::Horn)
        Horn->Play();
    else if (Kind == ESailingCue::Bell)
        Bell->Play();
    else
        BurstStart = SampleIndex;
}

void USailingVoyageSound::WhaleImpact(FVector Position, float Force)
{
    const auto* Player = Cast<APlayerController>(GetOwner());
    if (!bEnabled || !Whale || !Player) return;
    FVector Listener;
    FRotator Orientation;
    Player->GetPlayerViewPoint(Listener, Orientation);
    const double DistanceCm = FVector::Dist(Listener, Position);
    if (DistanceCm > Whale->AttenuationOverrides.GetMaxDimension()) return;
    Whale->SetWorldLocation(Position);
    WhaleGain = FMath::Lerp(.68f, .96f, Force);
    Whale->SetVolumeMultiplier(WhaleGain * Volume(ESailingAudioBus::World));
    Whale->SetPitchMultiplier(FMath::Lerp(1.04f, .94f, Force));
    constexpr double SoundSpeedCmS = 34300.;
    const float Delay = FMath::Max(.01, DistanceCm / SoundSpeedCmS);
    GetWorld()->GetTimerManager().SetTimer(WhaleDelay, this, &USailingVoyageSound::PlayWhaleImpact, Delay, false);
}

void USailingVoyageSound::PlayWhaleImpact()
{
    if (bEnabled && Whale) Whale->Play();
}

void USailingVoyageSound::UpdateUnderwater(float Depth, float DeltaTime)
{
    const bool bWasUnderwater = bUnderwater;
    // Use two depths so a wave brushing the camera does not restart the sound.
    bUnderwater = Depth >= (bWasUnderwater ? .06f : .22f);
    const bool bEntering = bUnderwater && !bWasUnderwater;
    if (bEntering)
    {
        if (!UnderwaterBed && UnderwaterRecording)
            UnderwaterBed = MakeVoice(UnderwaterRecording, TEXT("UnderwaterAmbienceVoice"));
        if (!UnderwaterWhale && !UnderwaterCalls.IsEmpty())
            UnderwaterWhale = MakeVoice(nullptr, TEXT("UnderwaterWhaleVoice"));
        NextCallIn = .65f;
    }
    if (!bUnderwater && ImmersionGain <= 0) return;

    ImmersionGain = FMath::FInterpConstantTo(ImmersionGain, bUnderwater ? 1.f : 0.f,
        DeltaTime, bUnderwater ? 1.8f : 2.7f);
    if (!bUnderwater && ImmersionGain <= 0)
    {
        if (UnderwaterBed) UnderwaterBed->SetPaused(true);
        if (UnderwaterWhale) UnderwaterWhale->Stop();
        return;
    }
    if (UnderwaterBed)
    {
        UnderwaterBed->SetVolumeMultiplier(.48f * ImmersionGain * Volume(ESailingAudioBus::World));
        if (bEntering)
        {
            UnderwaterBed->SetPaused(false);
            if (!UnderwaterBed->IsPlaying()) UnderwaterBed->Play();
        }
    }
    if (!UnderwaterWhale) return;
    UnderwaterWhale->SetVolumeMultiplier(.55f * ImmersionGain * Volume(ESailingAudioBus::World));
    if (!bUnderwater || UnderwaterWhale->IsPlaying()) return;

    NextCallIn -= DeltaTime;
    if (NextCallIn > 0) return;
    UnderwaterWhale->SetSound(UnderwaterCalls[NextWhaleCall]);
    UnderwaterWhale->Play();
    NextWhaleCall = (NextWhaleCall + 1) % UnderwaterCalls.Num();
    NextCallIn = 8.f;
}

void USailingVoyageSound::UpdateJetSki(const ASailingJetSki* Ski)
{
    if (!Ski || !bEngineAudible || !JetSkiRecording)
    {
        if (JetSkiVoice && JetSkiVoice->IsPlaying()) JetSkiVoice->Stop();
        return;
    }
    if (!JetSkiVoice)
    {
        JetSkiVoice = MakeVoice(JetSkiRecording, TEXT("JetSkiEngineVoice"));
        JetSkiVoice->SetLowPassFilterEnabled(true);
    }
    const float Power = FMath::Abs(Ski->Drive().Jet);
    JetSkiVoice->SetPitchMultiplier(FMath::Lerp(.55f, 1.04f, Power));
    JetSkiGain = FMath::Lerp(.21f, .75f, Power);
    JetSkiVoice->SetVolumeMultiplier(JetSkiGain * Volume(ESailingAudioBus::Engine));
    JetSkiVoice->SetLowPassFilterFrequency(FMath::Lerp(780.f, 10500.f, Power * Power));
    if (!JetSkiVoice->IsPlaying()) JetSkiVoice->Play();
}

void USailingVoyageSound::PlayFootstep(EFootstepSample Sample, float Gain, float Pitch,
                                      float LowPass, float HighPass, float MaxSeconds)
{
    FFootstepBank& Bank = FootstepBanks[int32(Sample)];
    if (Bank.Count == 0 || Gain <= 0.f) return;
    if (Bank.Remaining.IsEmpty())
    {
        for (int32 Index = 0; Index < Bank.Count; ++Index)
            Bank.Remaining.Add(Bank.First + Index);
    }
    int32 Choice = FootstepRandom.RandRange(0, Bank.Remaining.Num() - 1);
    if (Bank.Remaining.Num() > 1 && Bank.Remaining[Choice] == Bank.Last)
        Choice = (Choice + FootstepRandom.RandRange(1, Bank.Remaining.Num() - 1)) % Bank.Remaining.Num();
    Bank.Last = Bank.Remaining[Choice];
    Bank.Remaining.RemoveAtSwap(Choice);

    USoundWave* Clip = FootstepRecordings[Bank.Last];
    auto* Voice = FootstepVoices[NextFootstepVoice].Get();
    auto& Playback = FootstepPlayback[NextFootstepVoice];
    NextFootstepVoice = (NextFootstepVoice + 1) % FootstepVoices.Num();
    if (Voice->IsPlaying()) Voice->Stop();
    Pitch *= FootstepRandom.FRandRange(.92f, 1.08f);
    Playback = {};
    Playback.Gain = Gain * FootstepRandom.FRandRange(.86f, 1.14f);
    if (MaxSeconds > 0.f && MaxSeconds < Clip->GetDuration() / Pitch)
    {
        Playback.FadeSeconds = MaxSeconds * .1f;
        Playback.FadeDelay = MaxSeconds - Playback.FadeSeconds;
    }
    Voice->SetSound(Clip);
    Voice->SetVolumeMultiplier(Playback.Gain * Volume(ESailingAudioBus::World));
    Voice->SetPitchMultiplier(Pitch);
    Voice->SetLowPassFilterEnabled(LowPass > 0.f);
    if (LowPass > 0.f) Voice->SetLowPassFilterFrequency(LowPass);
    Voice->SetHighPassFilterEnabled(HighPass > 0.f);
    if (HighPass > 0.f) Voice->SetHighPassFilterFrequency(HighPass);
    Voice->Play();
}

void USailingVoyageSound::UpdateFootsteps(const ASailingYachtPawn& Yacht, float DeltaTime)
{
    for (int32 Index = 0; Index < FootstepVoices.Num(); ++Index)
    {
        auto& Playback = FootstepPlayback[Index];
        if (Playback.FadeDelay < 0.f) continue;
        Playback.FadeDelay -= DeltaTime;
        if (Playback.FadeDelay <= 0.f)
        {
            FootstepVoices[Index]->FadeOut(Playback.FadeSeconds, 0.f);
            Playback.FadeDelay = -1.f;
        }
    }
    const auto& Explorer = Yacht.Explorer();
    const auto& Step = Explorer.LastFootfall();
    if (Step.Sequence == LastFootfall) return;
    LastFootfall = Step.Sequence;
    if (Explorer.Mode() != ESkipperMode::Shore && Explorer.Mode() != ESkipperMode::Deck) return;
    using ESurface = USailingExplorer::EFootSurface;
    const float Strength = Step.Strength * FootstepRandom.FRandRange(.85f, 1.15f);
    const float Force = Strength * (Step.bRunning ? 1.45f : 1.f);
    const float Pace = Step.bRunning ? 1.07f : 1.f;
    switch (Step.Surface)
    {
    case ESurface::Deck:
        PlayFootstep(EFootstepSample::Deck, .38f * Force, 1.05f * Pace, 3000.f);
        break;
    case ESurface::Wood:
        PlayFootstep(EFootstepSample::Deck, .55f * Force, Pace);
        break;
    case ESurface::Sand:
        PlayFootstep(EFootstepSample::Ground, .50f * Force, .94f * Pace, 5200.f);
        PlayFootstep(EFootstepSample::Sand, .10f * Force, Pace);
        break;
    case ESurface::WetSand:
        PlayFootstep(EFootstepSample::Ground, .46f * Force, .90f * Pace, 2300.f);
        PlayFootstep(EFootstepSample::Water, .06f * Force, .90f, 720.f, 0.f, .25f);
        break;
    case ESurface::Grass:
        PlayFootstep(EFootstepSample::Ground, .42f * Force, 1.02f * Pace, 4200.f);
        PlayFootstep(EFootstepSample::Sand, .035f * Force, Pace, 4200.f, 2000.f);
        break;
    case ESurface::Rock:
        PlayFootstep(EFootstepSample::Ground, .50f * Force, 1.08f * Pace, 0.f, 140.f);
        break;
    case ESurface::Water:
        {
            // Blend a dull footfall at the waterline into the full slosh at knee depth.
            const float Deep = FMath::SmoothStep(.06f, .45f, Step.WaterDepthM);
            const float WadeForce = Strength * (Step.bRunning ? 1.4f : 1.f);
            if (Deep < .85f)
                PlayFootstep(EFootstepSample::Ground, .38f * WadeForce * (1.f - Deep), .90f, 2200.f);
            const float Gain = (.13f + .39f * Deep) * WadeForce;
            const float Pitch = (.93f + .07f * Deep) * (Step.bRunning ? 1.08f : 1.f);
            const float LowPass = Deep > .92f ? 0.f : 1300.f + 5600.f * Deep * Deep;
            const float Length = (.42f + .58f * Deep) * (Step.bRunning ? .8f : 1.2f);
            PlayFootstep(EFootstepSample::Water, Gain, Pitch, LowPass, 0.f, Length);
            break;
        }
    }
}

void USailingVoyageSound::FillBlock(float Speed, float Weather, float Depth)
{
    // Sea, wind, splashes and the onboard band share a short ambience queue.
    static constexpr int Notes[] = {9, 9, 9, 9, 9, 9, 9, 5, 2, 5,  9,  9,  7,  7, 7, 7, 7, 7, 7, 4, 0, 4,
                                    7, 7, 9, 9, 9, 9, 9, 9, 9, 10, 12, 14, 12, 9, 7, 4, 0, 2, 2, 2, 2, 2};
    const float Wet = FMath::Clamp(Depth / .8f, 0.f, 1.f);
    for (int32 I = 0; I < Block; ++I, ++SampleIndex)
    {
        const double T = double(SampleIndex) / Rate;
        NoiseSeed = 1664525u * NoiseSeed + 1013904223u;
        const float Noise = (NoiseSeed >> 8) * (2.f / 16777216.f) - 1;
        LowNoise += (Noise - LowNoise) * .035f;
        SeaNoise += (LowNoise - SeaNoise) * .065f;
        const float Surf = .65f + .35f * SinTone(T * .19 + .18f * SinTone(T * .47));
        float Sample = SeaNoise * (.45f + .25f * Weather) + LowNoise * (.22f + .13f * Speed) * Surf * (1 - .8f * Wet);
        const double Burst = double(SampleIndex - BurstStart) / Rate;
        if (Burst < .43) Sample += LowNoise * .85f * FMath::Exp(-7 * Burst);
        Sample *= Volume(ESailingAudioBus::World);
        if (Selected == BandStation)
        {
            const double Beat = double(SampleIndex - SongStart) / Rate * 3.92;
            const int Note = int(Beat) % UE_ARRAY_COUNT(Notes);
            const double NoteTime = FMath::Frac(Beat) / 3.92;
            const double Phase = NoteTime * (293.665 * FMath::Pow(2., Notes[Note] / 12.));
            const float Envelope = FMath::Min(1., NoteTime * 70) * FMath::Exp(-5 * NoteTime);
            Sample += Volume(ESailingAudioBus::Music) * Envelope *
                (.17f * SinTone(Phase) + .052f * SinTone(Phase * 2) + .025f * SinTone(Phase * 3));
        }
        PCM[I] = int16(FMath::Clamp(Sample, -.92f, .92f) * 32767);
    }
    Wave->QueueAudio(reinterpret_cast<uint8*>(PCM.GetData()), Block * sizeof(int16));
}

void USailingVoyageSound::UpdateAircraft(const ASailingPlayerController& Player, float Depth)
{
    const auto* Weather = Player.WorldWeather();
    const auto* Flight = Weather && Weather->AircraftSound() ? &Weather->AircraftSound().GetValue() : nullptr;
    FVector Listener;
    FRotator Rotation;
    Player.GetPlayerViewPoint(Listener, Rotation);
    constexpr float NearCm = 4500.f, FalloffCm = 65000.f;
    if (!Flight || Flight->Gain <= 0.f || FVector::DistSquared(Listener, Flight->PositionCm) >= FMath::Square(NearCm + FalloffCm))
    {
        if (AircraftVoice && AircraftVoice->IsPlaying()) AircraftVoice->Stop();
        return;
    }
    if (!AircraftVoice)
    {
        if (!GetWorld()->AllowAudioPlayback()) return;
        AircraftWave = NewObject<USoundWaveProcedural>(this);
        AircraftWave->SetSampleRate(Rate);
        AircraftWave->NumChannels = 1;
        AircraftWave->Duration = INDEFINITELY_LOOPING_DURATION;
        AircraftVoice = MakeVoice(AircraftWave, TEXT("PropellerVoice"));
        AircraftVoice->bAllowSpatialization = true;
        FSoundAttenuationSettings Attenuation;
        Attenuation.bSpatialize = Attenuation.bAttenuate = Attenuation.bAttenuateWithLPF = true;
        Attenuation.AttenuationShapeExtents = FVector(NearCm, 0, 0);
        Attenuation.FalloffDistance = FalloffCm;
        Attenuation.LPFRadiusMin = NearCm;
        Attenuation.LPFRadiusMax = NearCm + FalloffCm;
        Attenuation.LPFFrequencyAtMin = 10000.f;
        Attenuation.LPFFrequencyAtMax = 1250.f;
        AircraftVoice->AdjustAttenuation(Attenuation);
        AircraftVoice->SetLowPassFilterEnabled(true);

        // A seamless half-second loop of the engine firing and propeller blade passes.
        AircraftTone.SetNumUninitialized(Rate / 2);
        for (int32 I = 0; I < AircraftTone.Num(); ++I)
        {
            const double T = double(I) / Rate;
            const double Beat = 84. * T + .07 * SinTone(4. * T);
            const float Propeller = .32f * SinTone(Beat) + .20f * SinTone(Beat * 2. + .12) +
                .11f * SinTone(Beat * 3.) + .07f * SinTone(Beat * 5. + .28);
            const float Motor = .13f * SinTone(42. * T) + .06f * SinTone(126. * T + .1);
            AircraftTone[I] = int16((Motor + Propeller * (.87f + .13f * SinTone(6. * T))) * 32767);
        }
    }
    const int32 LoopBytes = AircraftTone.Num() * sizeof(int16);
    if (AircraftWave->GetAvailableAudioByteCount() < LoopBytes / 2)
        AircraftWave->QueueAudio(reinterpret_cast<const uint8*>(AircraftTone.GetData()), LoopBytes);
    constexpr double SoundSpeedCmS = 34300.;
    const double TowardListener = FVector::DotProduct(Flight->VelocityCmS, (Listener - Flight->PositionCm).GetSafeNormal());
    AircraftGain = .62f * Flight->Gain / (1.f + 4.f * Depth);
    AircraftVoice->SetWorldLocation(Flight->PositionCm);
    AircraftVoice->SetVolumeMultiplier(AircraftGain * Volume(ESailingAudioBus::World));
    AircraftVoice->SetLowPassFilterFrequency(FMath::Lerp(14500.f, 650.f, FMath::SmoothStep(.07f, .9f, Depth)));
    AircraftVoice->SetPitchMultiplier((Flight->bStunt ? 1.18 : .94) * SoundSpeedCmS / (SoundSpeedCmS - TowardListener));
    if (!AircraftVoice->IsPlaying()) AircraftVoice->Play();
}

void USailingVoyageSound::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTick)
{
    Super::TickComponent(DeltaTime, TickType, ThisTick);
#if PLATFORM_MAC
    if (LocalMusic) LocalMusic->Tick();
#endif
    if (TickType == LEVELTICK_PauseTick) return;
    const auto* Player = Cast<ASailingPlayerController>(GetOwner());
    if (const auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr) Update(*Player, *Yacht, DeltaTime);
}

void USailingVoyageSound::Update(const ASailingPlayerController& Player, const ASailingYachtPawn& Yacht, float DeltaTime)
{
    if (!bEnabled) return;
    if (!Speaker->IsPlaying() && FPlatformTime::Seconds() >= NextSpeakerStart)
    {
        Speaker->Play();
        NextSpeakerStart = FPlatformTime::Seconds() + .5;
    }
    if (Selected >= 0 && Selected < UE_ARRAY_COUNT(Channels) && Media && !bExhausted)
    {
        // A live connection can advertise playback before its first audio packet.
        // Try the next relay if the mixer stays silent.
        if (!bStreamStarted && Media->IsPlaying() && Radio->GetEnvelopeValue() > .0001f)
        {
            bStreamStarted = true;
            Radio->SetEnableEnvelopeFollowing(false);
        }
        if (Media->HasError() || (bStreamStarted && !Media->IsPlaying()) ||
            (!bStreamStarted && FPlatformTime::Seconds() - ConnectingSince > 12))
            TryServer();
    }
    const float Depth = Yacht.Explorer().DepthM();
    UpdateUnderwater(Depth, DeltaTime);
    UpdateFootsteps(Yacht, DeltaTime);
    const ASailingJetSki* Ski = Yacht.Explorer().MountedJetSki();
    UpdateJetSki(Ski);
    const auto& Helm = Yacht.ReadHelm();
    UpdateAircraft(Player, Depth);
    const float Engine = !Ski && Helm.bEngineOn && bEngineAudible ? .25f + .75f * FMath::Abs(Helm.Throttle) : 0;
    if (Engine > 0)
    {
        Diesel->SetPitchMultiplier(.75f + Engine*.75f);
        DieselGain = (.14f + .51f * Engine) / (1.f + .18f * Depth);
        Diesel->SetVolumeMultiplier(DieselGain * Volume(ESailingAudioBus::Engine));
        if (!Diesel->IsPlaying()) Diesel->Play();
    }
    else if (Diesel->IsPlaying()) Diesel->Stop();
    for (int I = 0; I < BufferedBlocks && Wave->GetAvailableAudioByteCount() < Block * BufferedBlocks * int(sizeof(int16)); ++I)
        FillBlock(Yacht.GetVelocity().Size2D() * .002, Yacht.SeaFrame().Scale, Depth);
}

void USailingVoyageSound::EndPlay(const EEndPlayReason::Type Reason)
{
    SetComponentTickEnabled(false);
#if PLATFORM_MAC
    LocalMusic.Reset();
#endif
    GetWorld()->GetTimerManager().ClearTimer(WhaleDelay);
    if (Media) Media->Close();
    if (Radio) Radio->Stop();
    for (UAudioComponent* Voice : FootstepVoices)
        Voice->DestroyComponent();
    for (auto* Voice : {Diesel.Get(), Horn.Get(), Bell.Get(), Speaker.Get(), Whale.Get(), UnderwaterBed.Get(),
                        UnderwaterWhale.Get(), JetSkiVoice.Get(), AircraftVoice.Get()})
        if (Voice) Voice->DestroyComponent();
    Super::EndPlay(Reason);
}
