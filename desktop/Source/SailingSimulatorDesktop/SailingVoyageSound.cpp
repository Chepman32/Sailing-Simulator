#include "SailingVoyageSound.h"

#include "Components/AudioComponent.h"
#include "MediaPlayer.h"
#include "MediaSoundComponent.h"
#include "Sound/SoundWaveProcedural.h"
#include "SailingExplorer.h"
#include "SailingTrial.h"

namespace
{
constexpr int Rate = 24000, Block = 1024;
const TCHAR* const Stations[] = {TEXT("SomaFM · Groove Salad"), TEXT("SomaFM · Underground 80s"),
                                 TEXT("SomaFM · Heavyweight Reggae"), TEXT("Onboard shanty band")};
const TCHAR* const Channels[] = {TEXT("groovesalad"), TEXT("u80s"), TEXT("reggae")};
const TCHAR* const Servers[] = {TEXT("ice2"), TEXT("ice4"), TEXT("ice1"), TEXT("ice")};
float SinTone(double Phase)
{
    return FMath::Sin(UE_DOUBLE_TWO_PI * Phase);
}
} // namespace

void USailingVoyageSound::StartSpeaker()
{
    if (!Wave)
    {
        Wave = NewObject<USoundWaveProcedural>(this);
        Wave->SetSampleRate(Rate);
        Wave->NumChannels = 1;
        Wave->Duration = INDEFINITELY_LOOPING_DURATION;
        Wave->SoundGroup = SOUNDGROUP_Default;
        Speaker = NewObject<UAudioComponent>(GetOwner());
        Speaker->bAutoActivate = false;
        Speaker->bAllowSpatialization = false;
        Speaker->SetSound(Wave);
        Speaker->RegisterComponent();
        PCM.SetNumUninitialized(Block);
    }
    Wave->ResetAudio();
    FillBlock(0, 0, 1, 0);
    Speaker->Play();
}

void USailingVoyageSound::Toggle()
{
    bEnabled = !bEnabled;
    if (bEnabled)
        StartSpeaker();
    else if (Speaker)
    {
        Speaker->Stop();
        Wave->ResetAudio();
        HornStart = BellStart = BurstStart = -1000000;
    }
    ApplyStation();
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
        HornStart = SampleIndex;
    else if (Kind == ESailingCue::Bell)
        BellStart = SampleIndex;
    else
        BurstStart = SampleIndex;
}

void USailingVoyageSound::FillBlock(float Engine, float Speed, float Weather, float Depth)
{
    // One bounded mono bus. The engine, breaking water, wind and signal envelopes
    // are mixed into a short queue; a muted game creates no audio work.
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
        if (Engine > 0)
        {
            EnginePhase = FMath::Fmod(EnginePhase + (25 + Engine * 63) / Rate, 1.);
            Sample += Engine * (.16f * SinTone(EnginePhase) + .055f * SinTone(2 * EnginePhase) +
                                .018f * SinTone(4 * EnginePhase));
        }
        const double Horn = double(SampleIndex - HornStart) / Rate;
        const double Bell = double(SampleIndex - BellStart) / Rate;
        const double Burst = double(SampleIndex - BurstStart) / Rate;
        if (Horn < 1.55)
        {
            const float Envelope = FMath::Min(1., Horn * 15) * FMath::Clamp((1.55 - Horn) * 6., 0., 1.);
            const double Phase = 168 * Horn - .31 * (1 - FMath::Exp(-14 * Horn));
            Sample += Envelope * (.27f * SinTone(Phase) + .15f * SinTone(2 * Phase) + .065f * SinTone(3 * Phase));
        }
        if (Bell < 3.4)
            Sample += FMath::Exp(-1.8 * Bell) *
                      (.26f * SinTone(707 * Bell) + .16f * SinTone(710 * Bell) + .10f * SinTone(1593 * Bell));
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

void USailingVoyageSound::Update(const ASailingYachtPawn& Yacht)
{
    if (!bEnabled) return;
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
    const float Engine = Helm.bEngineOn ? .25f + .75f * FMath::Abs(Helm.Throttle) : 0;
    for (int I = 0; I < 4 && Wave->GetAvailableAudioByteCount() < Block * 3 * int(sizeof(int16)); ++I)
        FillBlock(Engine, Yacht.GetVelocity().Size2D() * .002, Yacht.SeaFrame().Scale, Yacht.Explorer().DepthM());
}

void USailingVoyageSound::EndPlay(const EEndPlayReason::Type Reason)
{
    if (Media) Media->Close();
    if (Radio) Radio->Stop();
    if (Speaker) Speaker->Stop();
    Super::EndPlay(Reason);
}
