#include "SailingVoyageSound.h"

#include "Components/AudioComponent.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"
#include "MediaPlayer.h"
#include "MediaSoundComponent.h"
#include "Sound/SoundWaveProcedural.h"
#include "SailingExplorer.h"
#include "SailingTrial.h"

namespace
{
constexpr int Rate = 24000, Block = 1024;
constexpr int BufferedBlocks = 5;
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
    static ConstructorHelpers::FObjectFinder<USoundWave> Motor(TEXT("/Game/Coastal/Audio/MarineDiesel"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Typhon(TEXT("/Game/Coastal/Audio/MarineHorn"));
    static ConstructorHelpers::FObjectFinder<USoundWave> Chime(TEXT("/Game/Coastal/Audio/ShipBell"));
    DieselRecording = Motor.Object;
    HornRecording = Typhon.Object;
    BellRecording = Chime.Object;
}

UAudioComponent* USailingVoyageSound::MakeVoice(USoundWave* Recording)
{
    auto* Voice = NewObject<UAudioComponent>(GetOwner());
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
        Horn->SetVolumeMultiplier(.50f);
        Bell->SetVolumeMultiplier(.68f);
        PCM.SetNumUninitialized(Block);
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
        StartSpeaker();
    else if (Speaker)
    {
        Speaker->Stop();
        Diesel->Stop();
        Horn->Stop();
        Bell->Stop();
        BurstStart = -1000000;
    }
}

void USailingVoyageSound::Tune(int Direction)
{
    constexpr int Last = UE_ARRAY_COUNT(Stations) - 1;
    if (Direction < 0) Selected = Selected <= 0 ? Last : Selected - 1;
    else Selected = Selected == Last ? -1 : Selected + 1;
    ApplyStation();
}

void USailingVoyageSound::ApplyStation()
{
    if (Media) Media->Close();
    if (Radio) Radio->Stop();
    Server = 0;
    bExhausted = bStreamStarted = false;
    SongStart = SampleIndex;
    if (!bEnabled || Selected < 0 || Selected >= UE_ARRAY_COUNT(Channels)) return;
    if (!Media)
    {
        Media = NewObject<UMediaPlayer>(this);
        Media->PlayOnOpen = true;
        Radio = NewObject<UMediaSoundComponent>(GetOwner());
        Radio->bAutoActivate = false;
        Radio->bAllowSpatialization = false;
        Radio->SetMediaPlayer(Media);
        Radio->SetVolumeMultiplier(.43f);
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
        if (Selected == 3)
        {
            const double Beat = double(SampleIndex - SongStart) / Rate * 3.92;
            const int Note = int(Beat) % UE_ARRAY_COUNT(Notes);
            const double NoteTime = FMath::Frac(Beat) / 3.92;
            const double Phase = NoteTime * (293.665 * FMath::Pow(2., Notes[Note] / 12.));
            const float Envelope = FMath::Min(1., NoteTime * 70) * FMath::Exp(-5 * NoteTime);
            Sample += Envelope * (.17f * SinTone(Phase) + .052f * SinTone(Phase * 2) + .025f * SinTone(Phase * 3));
        }
        PCM[I] = int16(FMath::Clamp(Sample, -.92f, .92f) * 32767);
    }
    Wave->QueueAudio(reinterpret_cast<uint8*>(PCM.GetData()), Block * sizeof(int16));
}

void USailingVoyageSound::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTick)
{
    Super::TickComponent(DeltaTime, TickType, ThisTick);
    const auto* Player = Cast<APlayerController>(GetOwner());
    if (const auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr) Update(*Yacht);
}

void USailingVoyageSound::Update(const ASailingYachtPawn& Yacht)
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
    const auto& Helm = Yacht.ReadHelm();
    const float Engine = Helm.bEngineOn && bEngineAudible ? .25f + .75f * FMath::Abs(Helm.Throttle) : 0;
    if (Engine > 0)
    {
        Diesel->SetPitchMultiplier(.75f + Engine*.75f);
        Diesel->SetVolumeMultiplier((.14f + .51f*Engine) / (1.f + .18f*Yacht.Explorer().DepthM()));
        if (!Diesel->IsPlaying()) Diesel->Play();
    }
    else if (Diesel->IsPlaying()) Diesel->Stop();
    for (int I = 0; I < BufferedBlocks && Wave->GetAvailableAudioByteCount() < Block * BufferedBlocks * int(sizeof(int16)); ++I)
        FillBlock(Yacht.GetVelocity().Size2D() * .002, Yacht.SeaFrame().Scale, Yacht.Explorer().DepthM());
}

void USailingVoyageSound::EndPlay(const EEndPlayReason::Type Reason)
{
    SetComponentTickEnabled(false);
    if (Media) Media->Close();
    if (Radio) Radio->Stop();
    for (auto* Voice : {Diesel.Get(), Horn.Get(), Bell.Get(), Speaker.Get()})
        if (Voice) Voice->DestroyComponent();
    Super::EndPlay(Reason);
}
