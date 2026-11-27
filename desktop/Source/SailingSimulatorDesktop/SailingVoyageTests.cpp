#include "SailingPlayerController.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "AudioDevice.h"
#include "Components/AudioComponent.h"
#include "Components/BoxComponent.h"
#include "ISubmixBufferListener.h"
#include "Sound/SoundWave.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "SailingExplorer.h"
#include "SailingEntryBubbles.h"
#include "SailingSignal.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "SailingWeather.h"
#include "Slate/SceneViewport.h"
#include "UnrealClient.h"

namespace
{
void SetKey(ASailingPlayerController& Player, FKey Key, bool Down)
{
    Player.InputKey(FInputKeyEventArgs::CreateSimulated(Key, Down ? IE_Pressed : IE_Released, Down ? 1.f : 0.f));
}
void TapKey(ASailingPlayerController& Player, FKey Key)
{
    SetKey(Player, Key, true);
    SetKey(Player, Key, false);
}

class FWatchSurfaceSwim : public IAutomationLatentCommand
{
public:
    FWatchSurfaceSwim(ASailingPlayerController& InPlayer, FAutomationTestBase& InTest)
        : Player(&InPlayer), Test(InTest) {}

    bool Update() override
    {
        auto* Yacht = Player.IsValid() ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
        if (!Test.TestNotNull(TEXT("Playable yacht for the surface swim"), Yacht)) return true;
        const double Now = Yacht->GetWorld()->GetTimeSeconds();
        if (Start < 0.)
        {
            TapKey(*Player, EKeys::T);
            Start = Now;
        }
        const double Age = Now - Start;
        USailingExplorer& Explorer = Yacht->Explorer();
        if (Age < 5.5)
        {
            if (Explorer.Mode() == ESkipperMode::Swim)
            {
                FVector Eye;
                FRotator View;
                Player->GetPlayerViewPoint(Eye, View);
                const double Depth = Yacht->RenderedSurfaceHeightM(FVector2D(Eye)*.01) - Eye.Z*.01;
                PeakEntryDepth = FMath::Max(PeakEntryDepth, Depth);
            }
            return false;
        }
        if (Age < 13.)
        {
            if (Explorer.Mode() != ESkipperMode::Swim) return false;
            FVector Eye;
            FRotator View;
            Player->GetPlayerViewPoint(Eye, View);
            const double Clearance = Eye.Z - 100.*Yacht->SurfaceHeightM(FVector2D(Eye)*.01);
            MinClearanceCm = FMath::Min(MinClearanceCm, Clearance);
            if (Explorer.DepthM() > 0 || Explorer.PostProcessBlendWeight > 0) ++ImmersedFrames;
            ++Samples;
            return false;
        }

        if (Stage == 0)
        {
            Explorer.Look(0, (-62.f - Explorer.GetComponentRotation().Pitch) / .13f);
            Stage = 1;
            return false;
        }
        if (Age < 13.6) return false;
        if (Stage == 1)
        {
            Test.TestEqual(TEXT("Looking down while treading water keeps the head above water"), Explorer.DepthM(), 0.f);
            SetKey(*Player, EKeys::W, true);
            Stage = 2;
            return false;
        }
        if (Age < 15.) return false;
        if (Stage == 2)
        {
            SetKey(*Player, EKeys::W, false);
            FVector Eye;
            FRotator View;
            Player->GetPlayerViewPoint(Eye, View);
            const double CameraDepth = Yacht->RenderedSurfaceHeightM(FVector2D(Eye)*.01) - Eye.Z*.01;
            Test.AddInfo(FString::Printf(TEXT("Swimming forward looking down took the camera %.2f m below the waves"), CameraDepth));
            Test.TestTrue(TEXT("A forward stroke looking down dives from a settled floating camera"), CameraDepth > .6);
            SetKey(*Player, EKeys::SpaceBar, true);
            Stage = 3;
            return false;
        }
        if (Age < 18.) return false;
        if (Stage == 3)
        {
            SetKey(*Player, EKeys::SpaceBar, false);
            Test.TestEqual(TEXT("The swimmer resurfaced before the next dive"), Explorer.DepthM(), 0.f);
            TapKey(*Player, EKeys::SpaceBar);
            TapKey(*Player, EKeys::C);
            Stage = 4;
            return false;
        }
        if (Age < 19.7) return false;
        Test.AddInfo(FString::Printf(TEXT("The next C tap took the swimmer %.2f m below the waves"), Explorer.DepthM()));
        Test.TestTrue(TEXT("A dive tapped during a surface kick carries on underwater after re-entry"), Explorer.DepthM() > .6f);
        Test.AddInfo(FString::Printf(TEXT("Entry reached %.2f m; lowest surface camera clearance %.1f cm over %d frames"),
            PeakEntryDepth, MinClearanceCm, Samples));
        Test.TestTrue(TEXT("The live overboard camera plunges about two metres before surfacing"),
            PeakEntryDepth >= 1.8 && PeakEntryDepth <= 2.5);
        Test.TestTrue(TEXT("The floating view clears the waves with room for the near plane"), Samples > 30 && MinClearanceCm >= 15.);
        Test.TestEqual(TEXT("The underwater view stays off during the surface swim"), ImmersedFrames, 0);
        if (Explorer.Away()) TapKey(*Player, EKeys::T);
        return true;
    }

private:
    TWeakObjectPtr<ASailingPlayerController> Player;
    FAutomationTestBase& Test;
    double Start = -1., MinClearanceCm = TNumericLimits<double>::Max();
    double PeakEntryDepth = 0.;
    int32 Samples = 0, ImmersedFrames = 0, Stage = 0;
};

// Optional on-device capture of settled frames and the live station. The normal
// regression suite needs neither the network nor a writable screenshot directory.
class FInspectVoyage : public IAutomationLatentCommand
{
  public:
    FInspectVoyage(ASailingPlayerController& InPlayer, FAutomationTestBase& InTest, FString InFolder, bool bLive)
        : Player(&InPlayer), Test(InTest), Folder(MoveTemp(InFolder)), bCheckLive(bLive)
    {
    }
    bool Update() override
    {
        if (!Player.IsValid()) return true;
        const double Now = FPlatformTime::Seconds();
        if (Now < Next) return false;
        const auto Tap = [&](FKey Key) { TapKey(*Player.Get(), Key); };
        const auto Photo = [&](const TCHAR* Name) {
            if (!Folder.IsEmpty()) FScreenshotRequest::RequestScreenshot(FPaths::Combine(Folder, Name), false, false);
        };
        switch (Stage++)
        {
        case 0:
            Tap(EKeys::Q);
            Next = Now + .9;
            break;
        case 1:
            Photo(TEXT("coral-chart.png"));
            Next = Now + .5;
            break;
        case 2:
            Tap(EKeys::Q);
            Tap(EKeys::T);
            Next = Now + 4.6;
            break;
        case 3:
            SetKey(*Player.Get(), EKeys::C, true);
            Tap(EKeys::F);
            Next = Now + 2.4;
            break;
        case 4:
            SetKey(*Player.Get(), EKeys::C, false);
            Photo(TEXT("coral-dive.png"));
            Next = Now + .6;
            break;
        case 5:
            Tap(EKeys::T);
            Tap(EKeys::F);
            Next = Now + 2.1;
            break;
        case 6:
            Photo(TEXT("coral-signal.png"));
            Next = Now + .6;
            break;
        case 7:
            Tap(EKeys::R);
            if (!bCheckLive) return true;
            Tap(EKeys::O);
            Tap(EKeys::M);
            Test.TestEqual(TEXT("The live check tuned Groove Salad"), Player->Sound().Station(), 0);
            Started = Now;
            Next = Now + .3;
            break;
        default:
            if (!Player->Sound().StreamPlaying() && Now - Started < 48)
            {
                Next = Now + .3;
                return false;
            }
            Test.TestTrue(TEXT("A live SomaFM station plays through the native media player"),
                          Player->Sound().StreamPlaying());
            Tap(EKeys::M);
            return true;
        }
        return false;
    }

  private:
    TWeakObjectPtr<ASailingPlayerController> Player;
    FAutomationTestBase& Test;
    FString Folder;
    bool bCheckLive;
    int Stage = 0;
    double Next = 0, Started = 0;
};

class FVoyageMixMeter final : public ISubmixBufferListener
{
public:
    void OnNewSubmixBuffer(const USoundSubmix*, float* Data, int32 Count, int32, int32, double) override
    {
        float Peak = 0;
        for (int32 I = 0; I < Count; ++I) Peak = FMath::Max(Peak, FMath::Abs(Data[I]));
        LatestPeak.Store(Peak);
    }

    TAtomic<float> LatestPeak{0};
};

class FCheckRecordedAudio final : public IAutomationLatentCommand
{
public:
    FCheckRecordedAudio(ASailingPlayerController& InPlayer, FAutomationTestBase& InTest)
        : Player(&InPlayer), Test(InTest), Device(InPlayer.GetWorld()->GetAudioDevice()), bOriginalSound(InPlayer.Sound().Enabled()) {}

    ~FCheckRecordedAudio() override
    {
        for (const auto& Voice : Voices)
            if (auto* Component = Voice.Component.Get()) Component->OnAudioSingleEnvelopeValueNative.Remove(Voice.Handle);
        if (Device && Meter) Device->UnregisterSubmixBufferListener(Meter.ToSharedRef(), Device->GetMainSubmixObject());
        if (Player.IsValid() && Player->Sound().Enabled() != bOriginalSound) TapKey(*Player,EKeys::M);
    }

    bool Update() override
    {
        if (!Player.IsValid() || !Device) return true;
        auto* Yacht = Player->GetPawn<ASailingYachtPawn>();
        if (!Yacht) return true;
        const double Now = FPlatformTime::Seconds();
        if (!Meter)
        {
            Meter = MakeShared<FVoyageMixMeter, ESPMode::ThreadSafe>();
            Device->RegisterSubmixBufferListener(Meter.ToSharedRef(), Device->GetMainSubmixObject());
            // Prepare the lazily created components before their playback starts.
            TapKey(*Player, EKeys::M);
            if (Player->Sound().Enabled()) TapKey(*Player, EKeys::M);
            for (UAudioComponent* Component : TInlineComponentArray<UAudioComponent*>(Player.Get()))
            {
                if (Component->GetFName() == TEXT("UnderwaterAmbienceVoice") ||
                    Component->GetFName() == TEXT("UnderwaterWhaleVoice") ||
                    Component->GetFName() == TEXT("JetSkiEngineVoice") ||
                    Component->GetFName().GetPlainNameString() == TEXT("SkipperFootstepVoice")) continue;
                const auto* Sound = Component->GetSound();
                if (!Sound) continue;
                if (Sound->GetFName() == TEXT("MarineDiesel"))
                {
                    EngineVoice = Component;
                    const auto* Recording = Cast<USoundWave>(Sound);
                    Test.TestTrue(TEXT("The engine recording loops"), Recording && Recording->bLooping);
                }
                auto Peak = MakeShared<float>(0);
                const FDelegateHandle Handle = Component->OnAudioSingleEnvelopeValueNative.AddLambda(
                    [Peak](const UAudioComponent*, const USoundWave*, float Value) { *Peak = FMath::Max(*Peak, Value); });
                Voices.Add({Component, Sound->GetName(), Handle, Peak});
            }
            Test.TestEqual(TEXT("The surface ambience and four recorded sources are connected"), Voices.Num(), 5);
            Test.TestTrue(TEXT("The yacht has an engine recording"), EngineVoice.IsValid());
            TapKey(*Player, EKeys::M);
            Yacht->SetEngineRunning(true);
            Yacht->SetThrottle(0);
            TapKey(*Player, EKeys::J);
            TapKey(*Player, EKeys::B);
            const FVector Offshore = Yacht->GetActorLocation() + Yacht->GetActorForwardVector().GetSafeNormal2D()*16000.;
            Player->Sound().WhaleImpact(Offshore, .8f);
            Deadline = Now + 5.;
            return false;
        }

        if (Stage == EStage::Idle)
        {
            const float Mixed = Meter->LatestPeak.Load();
            const bool bAllHeard = !Voices.ContainsByPredicate([](const FVoice& Voice) { return *Voice.Peak <= .002f; });
            if (Now < Deadline && (!bAllHeard || Mixed <= .002f)) return false;
            for (const auto& Voice : Voices)
                Test.TestTrue(Voice.Name + TEXT(" produces decoded audio"), *Voice.Peak > .002f);
            Test.TestTrue(TEXT("The mixed audio reaches the device output"), Mixed > .002f);
            if (const auto* Engine = EngineVoice.Get())
            {
                IdlePitch = Engine->PitchMultiplier;
                IdleVolume = Engine->VolumeMultiplier;
            }
            Yacht->SetThrottle(.8);
            Stage = EStage::UnderPower;
            Deadline = Now + .35;
            return false;
        }
        if (Now < Deadline) return false;
        if (Stage == EStage::UnderPower)
        {
            const auto* Engine = EngineVoice.Get();
            Test.TestTrue(TEXT("Opening the throttle raises the playing engine's pitch and volume"),
                Engine && Engine->IsPlaying() && Engine->PitchMultiplier > IdlePitch && Engine->VolumeMultiplier > IdleVolume);
            TapKey(*Player, EKeys::M);
            Yacht->SetEngineRunning(false);
            Yacht->SetThrottle(0);
            Stage = EStage::Muted;
            Deadline = Now + .6;
            return false;
        }
        Test.TestTrue(TEXT("The mixer goes quiet after muting"), Meter->LatestPeak.Load() < .002f);
        return true;
    }

private:
    enum class EStage { Idle, UnderPower, Muted };
    struct FVoice
    {
        TWeakObjectPtr<UAudioComponent> Component;
        FString Name;
        FDelegateHandle Handle;
        TSharedPtr<float> Peak;
    };
    TWeakObjectPtr<ASailingPlayerController> Player;
    FAutomationTestBase& Test;
    FAudioDeviceHandle Device;
    bool bOriginalSound;
    TSharedPtr<FVoyageMixMeter, ESPMode::ThreadSafe> Meter;
    TArray<FVoice> Voices;
    TWeakObjectPtr<UAudioComponent> EngineVoice;
    double Deadline = 0;
    float IdlePitch = 0, IdleVolume = 0;
    EStage Stage = EStage::Idle;
};

class FWatchUnderwaterAudio final : public IAutomationLatentCommand
{
public:
    FWatchUnderwaterAudio(ASailingPlayerController& InPlayer, FAutomationTestBase& InTest)
        : Player(&InPlayer), Test(InTest), bOriginalSound(InPlayer.Sound().Enabled()) {}

    ~FWatchUnderwaterAudio() override
    {
        if (Bed.IsValid()) Bed->OnAudioSingleEnvelopeValueNative.Remove(BedListener);
        if (Call.IsValid()) Call->OnAudioSingleEnvelopeValueNative.Remove(CallListener);
    }

    bool Update() override
    {
        auto* Yacht = Player.IsValid() ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
        if (!Test.TestNotNull(TEXT("The dive has a playable yacht"), Yacht)) return true;
        const double Now = Yacht->GetWorld()->GetTimeSeconds();
        const float Depth = Yacht->Explorer().DepthM();
        const auto WaitFor = [&](EStage Next, double Seconds) {
            Stage = Next;
            Deadline = Now + Seconds;
        };
        const auto Playing = [](const UAudioComponent* Voice) {
            return Voice && Voice->IsPlaying() && Voice->GetPlayState() != EAudioComponentPlayState::Paused;
        };
        switch (Stage)
        {
        case EStage::Start:
            if (!bOriginalSound) TapKey(*Player, EKeys::M);
            WaitFor(EStage::Helm, .6);
            return false;
        case EStage::Helm:
            if (Now < Deadline) return false;
            for (const auto* Voice : TInlineComponentArray<UAudioComponent*>(Player.Get()))
                if (Voice->GetFName() == TEXT("UnderwaterAmbienceVoice") || Voice->GetFName() == TEXT("UnderwaterWhaleVoice"))
                    Test.TestFalse(TEXT("Underwater recordings are silent at the helm"), Playing(Voice));
            TapKey(*Player, EKeys::T);
            SetKey(*Player, EKeys::C, true);
            WaitFor(EStage::Descend, 10.);
            return false;
        case EStage::Descend:
            if (Depth < 1.2f) break;
            for (auto* Voice : TInlineComponentArray<UAudioComponent*>(Player.Get()))
            {
                if (Voice->GetFName() == TEXT("UnderwaterAmbienceVoice")) Bed = Voice;
                if (Voice->GetFName() == TEXT("UnderwaterWhaleVoice")) Call = Voice;
            }
            if (!Bed.IsValid() || !Call.IsValid()) break;
            BedListener = Bed->OnAudioSingleEnvelopeValueNative.AddLambda(
                [this](const UAudioComponent*, const USoundWave*, float Level) { bHeardBed |= Level > .001f; });
            CallListener = Call->OnAudioSingleEnvelopeValueNative.AddLambda(
                [this](const UAudioComponent*, const USoundWave* Wave, float Level) {
                    if (Wave && Level > .001f) HeardCalls.Add(Wave->GetFName());
                });
            // The mixer enables envelope callbacks when each voice starts.
            TapKey(*Player, EKeys::M);
            TapKey(*Player, EKeys::M);
            SetKey(*Player, EKeys::C, false);
            WaitFor(EStage::Listen, 80.);
            return false;
        case EStage::Listen:
            if (!bHeardBed || !HeardCalls.Contains(TEXT("UnderwaterWhaleSong")) ||
                !HeardCalls.Contains(TEXT("UnderwaterWhaleHaunting")) ||
                !HeardCalls.Contains(TEXT("UnderwaterWhaleCreepy"))) break;
            Test.TestTrue(TEXT("All four recordings were heard while submerged"), Depth > .5f);
            if (Bed.IsValid())
            {
                const auto* Recording = Cast<USoundWave>(Bed->GetSound());
                Test.TestTrue(TEXT("The full underwater bed loops"), Recording && Recording->bLooping && Recording->Duration > 616.f);
            }
            TapKey(*Player, EKeys::M);
            WaitFor(EStage::Mute, .55);
            return false;
        case EStage::Mute:
            if (Now < Deadline) return false;
            Test.TestFalse(TEXT("Muting silences the underwater bed and calls"), Playing(Bed.Get()) || Playing(Call.Get()));
            TapKey(*Player, EKeys::M);
            WaitFor(EStage::Resume, 5.);
            return false;
        case EStage::Resume:
            if (!Playing(Bed.Get())) break;
            SetKey(*Player, EKeys::SpaceBar, true);
            WaitFor(EStage::Ascend, 8.);
            return false;
        case EStage::Ascend:
            if (Depth > .05f) break;
            SetKey(*Player, EKeys::SpaceBar, false);
            WaitFor(EStage::Fade, .9);
            return false;
        case EStage::Fade:
            if (Now < Deadline) return false;
            Test.TestTrue(TEXT("Surfacing pauses the ambient bed for the next dive"),
                Bed.IsValid() && Bed->GetPlayState() == EAudioComponentPlayState::Paused);
            Test.TestFalse(TEXT("Surfacing stops the whale calls"), Playing(Call.Get()));
            Restore(*Yacht);
            return true;
        }
        if (Now < Deadline) return false;
        Test.AddError(FString::Printf(TEXT("Underwater audio timed out at stage %d. Heard the bed: %d, distinct calls: %d"),
            static_cast<int32>(Stage), bHeardBed, HeardCalls.Num()));
        Restore(*Yacht);
        return true;
    }

private:
    enum class EStage { Start, Helm, Descend, Listen, Mute, Resume, Ascend, Fade };
    void Restore(ASailingYachtPawn& Yacht)
    {
        SetKey(*Player, EKeys::C, false);
        SetKey(*Player, EKeys::SpaceBar, false);
        if (Yacht.Explorer().Away()) TapKey(*Player, EKeys::T);
        if (Player->Sound().Enabled() != bOriginalSound) TapKey(*Player, EKeys::M);
    }

    TWeakObjectPtr<ASailingPlayerController> Player;
    FAutomationTestBase& Test;
    TWeakObjectPtr<UAudioComponent> Bed, Call;
    FDelegateHandle BedListener, CallListener;
    TSet<FName> HeardCalls;
    double Deadline = 0.;
    EStage Stage = EStage::Start;
    bool bOriginalSound, bHeardBed = false;
};
} // namespace

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingAudioOutputTest, "Sailing.Audio.DeviceOutput",
                                 EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI |
                                     EAutomationTestFlags::EngineFilter)

bool FSailingAudioOutputTest::RunTest(const FString&)
{
    UGameViewportClient* Client = GEngine->GameViewport;
    auto* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Player)) return false;
    if (!Player->GetWorld()->AllowAudioPlayback())
    {
        AddInfo(TEXT("Audio is disabled for this test run"));
        return true;
    }
    if (!TestTrue(TEXT("The game has an audio device"), Player->GetWorld()->GetAudioDevice().IsValid())) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FCheckRecordedAudio(*Player, *this));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingAircraftSoundTest, "Sailing.Audio.AircraftPass",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingAircraftSoundTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Player)) return false;
    if (!World->AllowAudioPlayback())
    {
        AddInfo(TEXT("Audio is disabled for this test run"));
        return true;
    }
    const auto* Weather = Player->WorldWeather();
    if (!TestTrue(TEXT("A daylight flight is passing the yacht"), Weather && Weather->AircraftSound().IsSet())) return false;
    auto& Sound = Player->Sound();
    const bool bWasEnabled = Sound.Enabled();
    const float Initial = Sound.Volume(ESailingAudioBus::World);
    Sound.SetEnabled(true);
    Sound.SetVolume(ESailingAudioBus::World, 1.f);
    Sound.TickComponent(1.f / 60.f, LEVELTICK_All, nullptr);
    UAudioComponent* Propeller = nullptr;
    for (auto* Voice : TInlineComponentArray<UAudioComponent*>(Player))
        if (Voice->GetFName() == TEXT("PropellerVoice")) Propeller = Voice;
    if (TestNotNull(TEXT("The passing plane has a voice"), Propeller))
    {
        TestTrue(TEXT("The propeller loop plays from the aircraft position"), Propeller->IsPlaying() &&
            Propeller->bAllowSpatialization && Propeller->GetComponentLocation().Equals(Weather->AircraftSound()->PositionCm, 1.));
        const float Gain = Propeller->VolumeMultiplier;
        Sound.SetVolume(ESailingAudioBus::World, .2f);
        TestTrue(TEXT("The world bus scales the audible propeller"), Gain > 0 && FMath::IsNearlyEqual(Propeller->VolumeMultiplier, .2f * Gain));
    }
    Sound.SetVolume(ESailingAudioBus::World, Initial);
    Sound.SetEnabled(bWasEnabled);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingUnderwaterAudioTest, "Sailing.Audio.UnderwaterAmbience",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingUnderwaterAudioTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Player)) return false;
    if (!World->AllowAudioPlayback())
    {
        AddInfo(TEXT("Audio is disabled for this test run"));
        return true;
    }
    ADD_LATENT_AUTOMATION_COMMAND(FWatchUnderwaterAudio(*Player, *this));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingFootstepAudioTest, "Sailing.Audio.Footsteps",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingFootstepAudioTest::RunTest(const FString&)
{
    auto* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("A live yacht for the footstep test"), Yacht)) return false;
    auto& Explorer = Yacht->Explorer();
    auto& Sound = Player->Sound();
    AActor* ShelfActor = World->SpawnActor<AActor>();
    if (!TestNotNull(TEXT("Flat footing for dry and wading steps"), ShelfActor)) return false;
    const FVector XY = Yacht->GetActorLocation() + FVector(1700, 1700, 0);
    const double Water = Yacht->RenderedSurfaceHeightM(FVector2D(XY) * .01) * 100.;
    auto* Shelf = NewObject<UBoxComponent>(ShelfActor);
    ShelfActor->SetRootComponent(Shelf);
    Shelf->SetBoxExtent({700, 700, 20});
    Shelf->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
    Shelf->SetCollisionResponseToAllChannels(ECR_Ignore);
    Shelf->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
    Shelf->RegisterComponent();
    Shelf->SetWorldLocation({XY.X, XY.Y, Water + 85.});
    const bool bWasEnabled = Sound.Enabled();
    const float OriginalVolume = Sound.Volume(ESailingAudioBus::World);
    Sound.SetEnabled(true);
    Sound.SetVolume(ESailingAudioBus::World, 1.f);
    TArray<const USoundWave*> Played;
    TMap<UAudioComponent*, FDelegateHandle> Listeners;
    for (auto* Voice : TInlineComponentArray<UAudioComponent*>(Player))
    {
        if (Voice->GetFName().GetPlainNameString() != TEXT("SkipperFootstepVoice")) continue;
        Listeners.Add(Voice, Voice->OnAudioPlayStateChangedNative.AddLambda(
            [&, Voice](const UAudioComponent*, EAudioComponentPlayState State) {
                if (State == EAudioComponentPlayState::Playing)
                    if (const auto* Clip = Cast<USoundWave>(Voice->GetSound())) Played.Add(Clip);
            }));
    }
    const auto Advance = [&](int32 Frames) {
        for (int32 I = 0; I < Frames; ++I)
        {
            Explorer.Advance(*Yacht, 1.f / 60.f);
            Sound.TickComponent(1.f / 60.f, LEVELTICK_All, nullptr);
        }
    };
    const auto PlayedSurface = [&](const TCHAR* Prefix) {
        return Played.ContainsByPredicate([&](const USoundWave* Clip) { return Clip->GetName().StartsWith(Prefix); });
    };
    TapKey(*Player, EKeys::T);
    Advance(300);
    Explorer.SetWorldLocation({XY.X, XY.Y, Water + 145.});
    Advance(10);
    TestTrue(TEXT("The skipper can stand on dry ground"), Explorer.Mode() == ESkipperMode::Shore);
    const auto Before = Explorer.LastFootfall().Sequence;
    const FVector WalkStart = Explorer.GetComponentLocation();
    Explorer.SetMovement({1., 0.}, false, false, false);
    Advance(18);
    const FVector AtPace = Explorer.GetComponentLocation();
    const double AccelerationTravel = FVector::Dist2D(WalkStart, AtPace);
    TestTrue(TEXT("The first walking stride accelerates from rest"), AccelerationTravel > 95 && AccelerationTravel < 160);
    Advance(42);
    TestEqual(TEXT("Walking on dry ground reaches 6.525 m/s"), FVector::Dist2D(AtPace, Explorer.GetComponentLocation()), 456.75, 1.);
    TestEqual(TEXT("Footfalls follow the distance walked"), int32(Explorer.LastFootfall().Sequence - Before), 3);
    for (int32 I = 0; I < 7; ++I)
    {
        Explorer.SetMovement({I % 2 == 0 ? -1. : 1., 0.}, false, false, false);
        Advance(60);
    }
    Explorer.SetMovement({0., 0.}, false, false, false);
    const FVector BrakeStart = Explorer.GetComponentLocation();
    Advance(20);
    const FVector Stopped = Explorer.GetComponentLocation();
    const double BrakeTravel = FVector::Dist2D(BrakeStart, Stopped);
    TestTrue(TEXT("The skipper settles within the last half step"), BrakeTravel > 18 && BrakeTravel < 75);
    Advance(10);
    TestTrue(TEXT("The skipper comes to a full stop"), FVector::Dist2D(Stopped, Explorer.GetComponentLocation()) < .1);
    TSet<const USoundWave*> GroundClips;
    const USoundWave* Previous = nullptr;
    bool bNoConsecutiveRepeat = true;
    for (const USoundWave* Clip : Played)
    {
        if (!Clip->GetName().StartsWith(TEXT("FootstepGround"))) continue;
        bNoConsecutiveRepeat &= Clip != Previous;
        Previous = Clip;
        GroundClips.Add(Clip);
    }
    TestEqual(TEXT("Walking plays all ten ground variants"), GroundClips.Num(), 10);
    TestTrue(TEXT("Consecutive steps use different recordings"), bNoConsecutiveRepeat);
    UAudioComponent* Footstep = nullptr;
    for (const auto& Listener : Listeners)
        if (!Footstep || Listener.Key->VolumeMultiplier > Footstep->VolumeMultiplier) Footstep = Listener.Key;
    if (TestNotNull(TEXT("Footsteps have a mixer voice"), Footstep))
    {
        const float Gain = Footstep->VolumeMultiplier;
        TestTrue(TEXT("The footfall has positive gain"), Gain > 0.f);
        Sound.SetVolume(ESailingAudioBus::World, .2f);
        TestEqual(TEXT("World volume scales footfalls"), Footstep->VolumeMultiplier, Gain * .2f, .001f);
        Sound.SetVolume(ESailingAudioBus::World, 1.f);
    }

    Explorer.Arrive(*Yacht, {XY.X, XY.Y, Water + 105.}, true);
    Explorer.SetMovement({1., 0.}, true, false, false);
    Advance(25);
    const FVector RunStart = Explorer.GetComponentLocation();
    Advance(15);
    TestEqual(TEXT("Running on dry ground reaches 10.125 m/s"),
        FVector::Dist2D(RunStart, Explorer.GetComponentLocation()), 253.125, 1.);

    TapKey(*Player, EKeys::T);
    TapKey(*Player, EKeys::T);
    Advance(300);
    FVector Ladder = Yacht->GetActorTransform().TransformPosition({-542, 229, 20});
    Ladder.Z = Yacht->RenderedSurfaceHeightM(FVector2D(Ladder) * .01) * 100. + 15.;
    Explorer.SetWorldLocation(Ladder);
    Advance(1);
    TapKey(*Player, EKeys::E);
    Explorer.SetMovement({1., 0.}, false, false, false);
    Advance(45);
    TestTrue(TEXT("Walking after climbing aboard plays a deck recording"), PlayedSurface(TEXT("FootstepDeck")));

    TapKey(*Player, EKeys::T);
    TapKey(*Player, EKeys::T);
    Advance(300);
    Shelf->SetWorldLocation({XY.X, XY.Y, Water - 70.});
    Explorer.SetWorldLocation({XY.X, XY.Y, Water + 46.});
    Advance(2);
    Played.Reset();
    Explorer.SetMovement({1., 0.}, false, false, false);
    Advance(65);
    TestTrue(TEXT("Walking in the shallows plays moving-water recordings"), PlayedSurface(TEXT("FootstepWater")));
    ShelfActor->Destroy();
    if (Explorer.Away()) TapKey(*Player, EKeys::T);
    for (const auto& Listener : Listeners) Listener.Key->OnAudioPlayStateChangedNative.Remove(Listener.Value);
    Sound.SetVolume(ESailingAudioBus::World, OriginalVolume);
    Sound.SetEnabled(bWasEnabled);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingSurfaceSwimTest, "Sailing.Voyage.FloatingCamera",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingSurfaceSwimTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local sailing player"), Player)) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FWatchSurfaceSwim(*Player, *this));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingSwimControlsTest, "Sailing.Voyage.SwimControls",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingSwimControlsTest::RunTest(const FString&)
{
    UWorld* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("Play world with a local yacht"), Yacht)) return false;
    auto& Explorer = Yacht->Explorer();
    auto& Slate = FSlateApplication::Get();
    Slate.SetAllUserFocusToGameViewport();
    const auto Key = [&](FKey Which, bool Down) {
        const FKeyEvent Event(Which, {}, 0, false, 0, 0);
        if (Down) Slate.ProcessKeyDownEvent(Event);
        else Slate.ProcessKeyUpEvent(Event);
    };
    const auto Tap = [&](FKey Which) { Key(Which, true); Key(Which, false); };
    const auto Advance = [&](int32 Frames) {
        for (int32 I = 0; I < Frames; ++I)
        {
            Player->PlayerTick(1.f / 60);
            Explorer.Advance(*Yacht, 1.f / 60);
        }
    };
    const auto SwimDistance = [&](int32 Frames) {
        const FVector Start = Explorer.GetComponentLocation();
        Advance(Frames);
        return FVector::Dist2D(Start, Explorer.GetComponentLocation());
    };

    Key(EKeys::LeftShift, true);
    Tap(EKeys::T);
    Advance(360);
    TestTrue(TEXT("The skipper is floating before the dive"),
        Explorer.Mode() == ESkipperMode::Swim && Explorer.DepthM() < .05f);
    // Give a deliberate multi-metre descent sufficient clearance under the swimmer,
    // independent of the berth or ship left by the preceding voyage test.
    const FVector2D OpenWater(-120.,-160.);
    Explorer.SetWorldLocation(FVector(OpenWater*100.,Yacht->RenderedSurfaceHeightM(OpenWater)*100.+46.));
    Key(EKeys::W, true);
    Advance(90);
    const double HeldSprint = SwimDistance(24);
    Key(EKeys::LeftShift, false);
    Advance(90);
    const double SurfaceCruise = SwimDistance(24);
    TestEqual(TEXT("Surface swimming covers 69 cm in 0.4 seconds"), SurfaceCruise, 69., 1.5);
    TestEqual(TEXT("Sustained surface sprint covers 144 cm in 0.4 seconds"), HeldSprint, 144., 1.5);
    TestTrue(TEXT("Shift held when going overboard still accelerates swimming"), HeldSprint > 1.8 * SurfaceCruise);
    Key(EKeys::LeftShift, true);
    const double SurfaceSprint = SwimDistance(24);
    Key(EKeys::LeftShift, false);
    Key(EKeys::W, false);
    Advance(90);
    TestTrue(TEXT("Shift noticeably accelerates surface swimming within one stroke"),
        SurfaceCruise > 35. && SurfaceSprint > 1.55 * SurfaceCruise);

#if PLATFORM_MAC
    constexpr int32 CKeyCode = 0x08;
    constexpr uint32 CyrillicEs = 0x441;
    Slate.OnKeyDown(CKeyCode, CyrillicEs, false);
    Slate.OnKeyUp(CKeyCode, CyrillicEs, false);
#else
    Tap(EKeys::C);
#endif
    Advance(90);
    TestTrue(TEXT("Tapping C from the surface takes the camera fully underwater"),
        Explorer.DepthM() > .5f);
    const float BeforeDescent = Explorer.DepthM();
    Explorer.Look(0, (65.f - Explorer.GetComponentRotation().Pitch) / .13f);
    Key(EKeys::W, true);
    Key(EKeys::LeftControl, true);
    Advance(75);
    Key(EKeys::LeftControl, false);
    AddInfo(FString::Printf(TEXT("Ctrl with forward input at 65 degrees up: %.2f m to %.2f m"),
        BeforeDescent, Explorer.DepthM()));
    TestTrue(TEXT("Holding Ctrl descends even when swimming forward while looking up"),
        Explorer.DepthM() > BeforeDescent + .75f);

    Explorer.Look(0, -Explorer.GetComponentRotation().Pitch / .13f);
    Advance(90);
    const double UnderwaterCruise = SwimDistance(24);
    Key(EKeys::RightShift, true);
    const double UnderwaterSprint = SwimDistance(24);
    Advance(90);
    const double HeldUnderwaterSprint = SwimDistance(24);
    Key(EKeys::RightShift, false);
    Advance(90);
    const double ReleasedSprint = SwimDistance(24);
    Key(EKeys::W, false);
    TestTrue(TEXT("Shift noticeably accelerates underwater swimming within one stroke"),
        Explorer.DepthM() > .5f && UnderwaterCruise > 55. && UnderwaterSprint > 1.55 * UnderwaterCruise);
    TestEqual(TEXT("Underwater swimming covers 105 cm in 0.4 seconds"), UnderwaterCruise, 105., 1.5);
    TestEqual(TEXT("Sustained underwater sprint covers 222 cm in 0.4 seconds"), HeldUnderwaterSprint, 222., 1.5);
    TestEqual(TEXT("Releasing Shift restores cruising speed"), ReleasedSprint, UnderwaterCruise, 3.);
    AddInfo(FString::Printf(TEXT("Distance in 0.4 s at cruise and sprint: surface %.0f/%.0f cm, underwater %.0f/%.0f cm"),
        SurfaceCruise, SurfaceSprint, UnderwaterCruise, UnderwaterSprint));

    Key(EKeys::SpaceBar, true);
    Advance(300);
    TestEqual(TEXT("Space returns the skipper to the surface"), Explorer.DepthM(), 0.f);
    Tap(EKeys::C);
    Advance(48);
    TestTrue(TEXT("A fresh dive takes priority over the Space key still held after surfacing"),
        Explorer.DepthM() > .5f);
    const float AfterDuckDive = Explorer.DepthM();
    Key(EKeys::RightControl, true);
    Advance(75);
    const float AfterHeldDive = Explorer.DepthM();
    TestTrue(TEXT("Holding Ctrl continues the dive past the initial stroke"),
        AfterHeldDive > AfterDuckDive + 1.f);

    Key(EKeys::SpaceBar, false);
    Key(EKeys::SpaceBar, true);
    Advance(78);
    TestTrue(TEXT("A fresh press of Space takes the swimmer back toward the surface"),
        Explorer.DepthM() < AfterHeldDive - .5f);
    Key(EKeys::RightControl, false);
    Key(EKeys::SpaceBar, false);

    // Lower a test shelf within the wading hysteresis to leave the player
    // standing in deep enough water to dive without first walking farther out.
    AActor* ShelfActor = World->SpawnActor<AActor>();
    if (TestNotNull(TEXT("Wading test shelf"), ShelfActor))
    {
        const FVector Eye = Explorer.GetComponentLocation();
        const double Water = Yacht->RenderedSurfaceHeightM(FVector2D(Eye) * .01) * 100.;
        auto* Shelf = NewObject<UBoxComponent>(ShelfActor);
        ShelfActor->SetRootComponent(Shelf);
        Shelf->SetBoxExtent({300, 300, 20});
        Shelf->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
        Shelf->SetCollisionResponseToAllChannels(ECR_Ignore);
        Shelf->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
        Shelf->RegisterComponent();
        Shelf->SetWorldLocation({Eye.X, Eye.Y, Water - 115});
        Explorer.SetWorldLocation({Eye.X, Eye.Y, Water + 46});
        Advance(2);
        TestTrue(TEXT("A shallow shelf allows standing"), Explorer.Mode() == ESkipperMode::Shore);

        Shelf->SetWorldLocation({Eye.X, Eye.Y, Water - 153});
        Advance(36);
        TestTrue(TEXT("The skipper is still wading before the dive"), Explorer.Mode() == ESkipperMode::Shore);
        Tap(EKeys::LeftControl);
        Advance(51);
        TestTrue(TEXT("Ctrl starts a dive from deeper wading water"),
            Explorer.Mode() == ESkipperMode::Swim && Explorer.DepthM() > .55f);
        ShelfActor->Destroy();
    }
    if (Explorer.Away()) Tap(EKeys::T);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingVoyageTest, "Sailing.Voyage.WebExplorationAndSignals",
                                 EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI |
                                     EAutomationTestFlags::EngineFilter)

bool FSailingVoyageTest::RunTest(const FString& Parameters)
{
    UGameViewportClient* Client = GEngine->GameViewport;
    auto* Player = Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("Play world with a local yacht"), Yacht)) return false;
    auto& Explorer = Yacht->Explorer();
    const auto Tap = [&](FKey Key) { TapKey(*Player, Key); };
    const auto Advance = [&](int Frames) {
        for (int I = 0; I < Frames; ++I)
        {
            Player->PlayerTick(1.f / 60);
            Explorer.Advance(*Yacht, 1.f / 60);
        }
    };
    TestTrue(TEXT("A fresh voyage starts with sound enabled"), Player->Sound().Enabled());
    TestEqual(TEXT("Startup ambience leaves the radio off"), Player->Sound().Station(), -1);
    if (Player->Sound().Enabled()) Tap(EKeys::M);
    Tap(EKeys::J);
    Tap(EKeys::B);
    TestFalse(TEXT("Signal keys do not unmute the game"), Player->Sound().Enabled());
    Tap(EKeys::M);
    Tap(EKeys::J);
    Tap(EKeys::B);
    int RecordedVoices=0;
    TInlineComponentArray<UAudioComponent*> Voices(Player);
    for (UAudioComponent* Voice : Voices)
    {
        auto* Clip=Cast<USoundWave>(Voice->GetSound());
        if (!Clip) continue;
        const FName Name=Clip->GetFName();
        const bool IsMotor=Name==TEXT("MarineDiesel");
        if (!IsMotor && Name!=TEXT("MarineHorn") && Name!=TEXT("ShipBell")) continue;
        ++RecordedVoices;
        TestEqual(TEXT("Only the engine recording loops"),bool(Clip->bLooping),IsMotor);
        TestTrue(TEXT("The recorded clip has audio"),Clip->Duration>1.f);
        if (!IsMotor && Player->GetWorld()->AllowAudioPlayback())
            TestTrue(TEXT("The signal key starts its recorded voice"),Voice->IsPlaying());
    }
    TestEqual(TEXT("All three recorded voices are bound to the player"),RecordedVoices,3);
    Tap(EKeys::M);
    const int64 MutedSamples = Player->Sound().SamplesWritten();
    Tap(EKeys::J);
    Tap(EKeys::B);
    Advance(2);
    TestFalse(TEXT("Signals respect the mute switch"), Player->Sound().Enabled());
    TestEqual(TEXT("The muted mixer stops producing samples"), Player->Sound().SamplesWritten(), MutedSamples);
    Tap(EKeys::Q);
    TestTrue(TEXT("Q opens a chart of the actual placed islands"),
             Player->GetPanel() == ESailingPanel::Chart && Player->ChartView().IslandCount() == 7);
    FSceneViewport* Scene = Client->GetGameViewport();
    if (!TestNotNull(TEXT("Chart viewport"), Scene)) return false;
    const FIntPoint Size = Scene->GetSizeXY();
    const FGeometry Geometry = FGeometry::MakeRoot(FVector2D(Size), FSlateLayoutTransform());
    const TSet<FKey> Buttons{EKeys::LeftMouseButton};
    const FVector2D Middle(Size.X * .5, Size.Y * .5);
    const FVector2D DragEnd = Middle + FVector2D(85, 35);
    const FVector2D OriginalCenter = Player->ChartView().Center;
    Scene->OnMouseButtonDown(Geometry, FPointerEvent(0, Middle, Middle, Buttons, EKeys::LeftMouseButton, 0, {}));
    Scene->OnMouseButtonUp(Geometry, FPointerEvent(0, DragEnd, Middle, Buttons, EKeys::LeftMouseButton, 0, {}));
    TestTrue(TEXT("Dragging pans the chart in world coordinates"), !Player->ChartView().bFollowing &&
             FVector2D::Distance(OriginalCenter, Player->ChartView().Center) > 10);
    const double Scale = Player->ChartView().MetersPerPixel;
    Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::MouseWheelAxis, IE_Axis, 1.f));
    TestTrue(TEXT("The scroll wheel changes chart scale"), Player->ChartView().MetersPerPixel < Scale);
    Tap(EKeys::R);
    TestTrue(TEXT("R follows the skipper on the chart"), Player->ChartView().bFollowing);
    Tap(EKeys::N);
    Tap(EKeys::Tab);
    TestTrue(TEXT("Tab opens the equipment panel"), Player->GetPanel() == ESailingPanel::Gear);
    Tap(EKeys::Escape);
    for (int I = 0; I < 4; ++I)
        Tap(EKeys::O);
    TestEqual(TEXT("Four forward selections reach the on-board station"), Player->Sound().Station(), 3);
    Tap(EKeys::M);
    Advance(2);
    TestTrue(TEXT("M activates an actual generated audio buffer"),
             Player->Sound().Enabled() && Player->Sound().SamplesWritten() > 0);
    Tap(EKeys::J);
    Tap(EKeys::B);
    Tap(EKeys::M);
    Tap(EKeys::O);
    TestEqual(TEXT("The radio cycles back to off"), Player->Sound().Station(), -1);
    Tap(EKeys::O);
    SetKey(*Player, EKeys::LeftShift, true);
    Player->PlayerTick(.016f);
    Tap(EKeys::O);
    SetKey(*Player, EKeys::LeftShift, false);
    TestEqual(TEXT("Shift+O on the first station wraps back to the band"), Player->Sound().Station(), 3);
    Tap(EKeys::O);
    TestEqual(TEXT("A released Shift immediately restores forward radio tuning"), Player->Sound().Station(), -1);
    Tap(EKeys::G);
    const ASailingSignal* Green = Player->CurrentSignal();
    if (TestNotNull(TEXT("G stages a signal"), Green))
    {
        TestTrue(TEXT("G selects green"), Green->IsGreen());
        TestTrue(TEXT("The camera cuts to the launch immediately"), Player->GetViewTarget() == Green);
        TestTrue(TEXT("The first frame places the signal on the yacht"), Green->GetActorLocation().Equals(
            Yacht->GetActorTransform().TransformPosition({-380, 165, 291}), 1.));
        TestEqual(TEXT("The rocket has not moved on the opening frame"), Green->Age(), 0.f);
    }
    Yacht->SetEngineRunning(true);
    Yacht->SetThrottle(.65);
    const uint32 BeforeWaterEntry = Explorer.LastWaterEntry().Sequence;
    Tap(EKeys::T);
    TestFalse(TEXT("Leaving a powered yacht cuts the engine"),Yacht->ReadHelm().bEngineOn);
    TestEqual(TEXT("The abandoned throttle is neutral"),Yacht->ReadHelm().Throttle,0.);
    TestTrue(TEXT("Overboard captures the mouse and heaves the yacht to"),
             Explorer.Away() && !Player->bShowMouseCursor && Yacht->ReadHelm().bHoveTo);
    float MaximumEntryDepth = 0;
    bool bContactBeforeSubmersion = false;
    for (int I=0; I<225; ++I)
    {
        Advance(1);
        MaximumEntryDepth = FMath::Max(MaximumEntryDepth,Explorer.DepthM());
        bContactBeforeSubmersion |= Explorer.Mode() == ESkipperMode::Leap &&
                                    Explorer.LastWaterEntry().Sequence > BeforeWaterEntry;
    }
    AddInfo(FString::Printf(TEXT("Overboard entry reached %.2f m"),MaximumEntryDepth));
    TestTrue(TEXT("An unassisted jump carries the eyes about two metres underwater"),
             MaximumEntryDepth>=1.8f && MaximumEntryDepth<=2.5f);
    TestTrue(TEXT("The leap ends in the water"), Explorer.Mode() == ESkipperMode::Swim);
    TestTrue(TEXT("Splash contact occurs before the eyes go underwater"), bContactBeforeSubmersion);
    TestEqual(TEXT("The leap emits one surface impact"), Explorer.LastWaterEntry().Sequence-BeforeWaterEntry, 1u);
    auto& Bubbles = Yacht->EntryBubbles();
    int32 SmallBubbles=0, MediumBubbles=0, LargeBubbles=0;
    for (int32 I=0; I<Bubbles.GetInstanceCount(); ++I)
    {
        FTransform Bubble;
        Bubbles.GetInstanceTransform(I,Bubble,true);
        const double Radius = Bubble.GetScale3D().GetMax()*50.;
        if (Radius<.65) ++SmallBubbles;
        else if (Radius<1.8) ++MediumBubbles;
        else ++LargeBubbles;
    }
    TestTrue(TEXT("Going overboard entrains pinhead, intermediate and large bubbles"),
             SmallBubbles>8 && MediumBubbles>6 && LargeBubbles>2 && Bubbles.GetInstanceCount()<=88);
    TestTrue(TEXT("Bubbles use the optical skin"), Bubbles.GetMaterial(0) && Bubbles.GetMaterial(0)->GetFName()==TEXT("M_EntryBubble"));
    for (int32 I=0; I<300 && Bubbles.IsComponentTickEnabled(); ++I)
        Bubbles.TickComponent(1.f/60,LEVELTICK_All,nullptr);
    TestTrue(TEXT("The entry plume clears completely"), Bubbles.GetInstanceCount()==0 && !Bubbles.IsComponentTickEnabled());
    SetKey(*Player, EKeys::W, true);
    const FVector BeforeSwim = Explorer.GetComponentLocation();
    Advance(36);
    SetKey(*Player, EKeys::W, false);
    TestTrue(TEXT("W swims without advancing the throttle"),
             FVector::Dist2D(BeforeSwim, Explorer.GetComponentLocation()) > 16 && Yacht->ReadHelm().Throttle == 0);
    const float BeforeLook = Explorer.GetComponentRotation().Yaw;
    Player->InputKey(FInputKeyEventArgs::CreateSimulated(EKeys::MouseX, IE_Axis, 100));
    TestTrue(TEXT("Captured mouse deltas look around"),
             FMath::Abs(FMath::FindDeltaAngleDegrees(BeforeLook, Explorer.GetComponentRotation().Yaw)) > 10);
    Tap(EKeys::F);
    TestTrue(TEXT("Underwater F switches on the dive torch"), Explorer.TorchOn());
    SetKey(*Player, EKeys::C, true);
    Advance(90);
    SetKey(*Player, EKeys::C, false);
    TestTrue(TEXT("Diving consumes air below the wave surface"),
             Explorer.DepthM() > .65f && Explorer.AirFraction() < 1);
    Tap(EKeys::Q);
    const FVector Frozen = Explorer.GetComponentLocation();
    Advance(15);
    TestTrue(TEXT("The chart releases the cursor and freezes the swimmer"),
             Player->bShowMouseCursor && Frozen.Equals(Explorer.GetComponentLocation()));
    Tap(EKeys::N);
    TestFalse(TEXT("Closing the chart restores first-person mouse capture"), Player->bShowMouseCursor);

    // Enter the shallows on the surveyed Light Cay, then test the real terrain.
    Explorer.SetWorldLocation({27200, -12200, 95});
    Advance(6);
    TestTrue(TEXT("Shallow water becomes walkable shore"), Explorer.Mode() == ESkipperMode::Shore);
    const FVector ShoreStart = Explorer.GetComponentLocation();
    SetKey(*Player, EKeys::W, true);
    SetKey(*Player, EKeys::LeftShift, true);
    Advance(12);
    SetKey(*Player, EKeys::W, false);
    SetKey(*Player, EKeys::LeftShift, false);
    TestTrue(TEXT("The skipper can move on the island"),
             FVector::Dist2D(ShoreStart, Explorer.GetComponentLocation()) > 10);
    // Let the last downhill stride settle before jumping from rest.
    Advance(26);
    const double Standing = Explorer.GetComponentLocation().Z;
    Tap(EKeys::SpaceBar);
    Advance(7);
    AddInfo(FString::Printf(TEXT("Jump height change %.2f cm"), Explorer.GetComponentLocation().Z - Standing));
    TestTrue(TEXT("Space jumps from the ground"), Explorer.GetComponentLocation().Z > Standing + 10);
    Tap(EKeys::T);
    Tap(EKeys::T);
    Advance(210);
    FVector Ladder = Yacht->GetActorTransform().TransformPosition({-542, 229, 20});
    const auto Sea = Yacht->SeaFrame();
    Ladder.Z = Sailing::SampleSea(FVector2D(Ladder) * .01, Sea.TimeS, 0, Sea.Scale).HeightM * 100 + 15;
    Explorer.SetWorldLocation(Ladder);
    Advance(1);
    Tap(EKeys::E);
    TestTrue(TEXT("E boards at the actual stern steps"),
             Explorer.Mode() == ESkipperMode::Deck &&
                 Yacht->GetActorTransform().InverseTransformPosition(Explorer.GetComponentLocation()).Z > 150);
    const FVector DeckStart = Explorer.GetComponentLocation();
    SetKey(*Player, EKeys::W, true);
    Advance(14);
    SetKey(*Player, EKeys::W, false);
    TestTrue(TEXT("Deck walking follows the yacht frame"),
             Explorer.Mode() == ESkipperMode::Deck && FVector::Dist2D(DeckStart, Explorer.GetComponentLocation()) > 12);
    Tap(EKeys::E);
    TestTrue(TEXT("E takes the nearby helm and releases the mouse"),
             !Explorer.Away() && Player->bShowMouseCursor && !Yacht->ReadHelm().bHoveTo);
    if (Explorer.Away()) Tap(EKeys::T);
    FString Shots;
    FParse::Value(FCommandLine::Get(), TEXT("SailingVoyageShots="), Shots);
    const bool bLive = FParse::Param(FCommandLine::Get(), TEXT("SailingLiveRadioCheck"));
    if (!Shots.IsEmpty() || bLive) ADD_LATENT_AUTOMATION_COMMAND(FInspectVoyage(*Player, *this, Shots, bLive));
    return true;
}
#endif
