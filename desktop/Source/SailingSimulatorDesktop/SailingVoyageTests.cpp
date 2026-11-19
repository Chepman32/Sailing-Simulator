#include "SailingPlayerController.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "SailingExplorer.h"
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
} // namespace

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
    TestFalse(TEXT("Audio starts silent"), Player->Sound().Enabled());
    Tap(EKeys::J);
    Tap(EKeys::B);
    TestFalse(TEXT("A signal does not arm audio"), Player->Sound().Enabled());
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
    Advance(210);
    TestTrue(TEXT("The leap ends in the water"), Explorer.Mode() == ESkipperMode::Swim);
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
