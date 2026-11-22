#include "SailingPlayerController.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "AudioDevice.h"
#include "Components/AudioComponent.h"
#include "ISubmixBufferListener.h"
#include "Sound/SoundWave.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "SailingExplorer.h"
#include "SailingEntryBubbles.h"
#include "SailingSignal.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
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
        : Player(&InPlayer), Test(InTest), Device(InPlayer.GetWorld()->GetAudioDevice()) {}

    ~FCheckRecordedAudio() override
    {
        for (const auto& Voice : Voices)
            if (auto* Component = Voice.Component.Get()) Component->OnAudioSingleEnvelopeValueNative.Remove(Voice.Handle);
        if (Device && Meter) Device->UnregisterSubmixBufferListener(Meter.ToSharedRef(), Device->GetMainSubmixObject());
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
                const auto* Sound = Component->GetSound();
                if (!Sound) continue;
                auto Peak = MakeShared<float>(0);
                const FDelegateHandle Handle = Component->OnAudioSingleEnvelopeValueNative.AddLambda(
                    [Peak](const UAudioComponent*, const USoundWave*, float Value) { *Peak = FMath::Max(*Peak, Value); });
                Voices.Add({Component, Sound->GetName(), Handle, Peak});
            }
            Test.TestEqual(TEXT("The ambience and three recorded sources are connected"), Voices.Num(), 4);
            TapKey(*Player, EKeys::M);
            Yacht->SetEngineRunning(true);
            Yacht->SetThrottle(.6);
            TapKey(*Player, EKeys::J);
            TapKey(*Player, EKeys::B);
            Deadline = Now + 5.;
            return false;
        }

        if (!bCheckingMute)
        {
            const float Mixed = Meter->LatestPeak.Load();
            const bool bAllHeard = !Voices.ContainsByPredicate([](const FVoice& Voice) { return *Voice.Peak <= .002f; });
            if (Now < Deadline && (!bAllHeard || Mixed <= .002f)) return false;
            for (const auto& Voice : Voices)
                Test.TestTrue(Voice.Name + TEXT(" produces decoded audio"), *Voice.Peak > .002f);
            Test.TestTrue(TEXT("The mixed audio reaches the device output"), Mixed > .002f);
            TapKey(*Player, EKeys::M);
            Yacht->SetEngineRunning(false);
            Yacht->SetThrottle(0);
            bCheckingMute = true;
            Deadline = Now + .6;
            return false;
        }
        if (Now < Deadline) return false;
        Test.TestTrue(TEXT("The mixer goes quiet after muting"), Meter->LatestPeak.Load() < .002f);
        return true;
    }

private:
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
    TSharedPtr<FVoyageMixMeter, ESPMode::ThreadSafe> Meter;
    TArray<FVoice> Voices;
    double Deadline = 0;
    bool bCheckingMute = false;
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
    TestFalse(TEXT("A fresh voyage waits for the sound control"), Player->Sound().Enabled());
    TestEqual(TEXT("Startup ambience leaves the radio off"), Player->Sound().Station(), -1);
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
    if (TestNotNull(TEXT("G launches a visible signal"), Green)) TestTrue(TEXT("G selects green"), Green->IsGreen());
    Tap(EKeys::T);
    TestTrue(TEXT("Overboard captures the mouse and heaves the yacht to"),
             Explorer.Away() && !Player->bShowMouseCursor && Yacht->ReadHelm().bHoveTo);
    float MaximumEntryDepth = 0;
    for (int I=0; I<225; ++I)
    {
        Advance(1);
        MaximumEntryDepth = FMath::Max(MaximumEntryDepth,Explorer.DepthM());
    }
    AddInfo(FString::Printf(TEXT("Overboard entry reached %.2f m"),MaximumEntryDepth));
    TestTrue(TEXT("An unassisted jump carries the eyes one to two metres underwater"),
             MaximumEntryDepth>=1.f && MaximumEntryDepth<=2.f);
    TestTrue(TEXT("The leap ends in the water"), Explorer.Mode() == ESkipperMode::Swim);
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
    const double Standing = Explorer.GetComponentLocation().Z;
    Tap(EKeys::SpaceBar);
    Advance(7);
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
