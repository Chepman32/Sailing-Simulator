#if WITH_DEV_AUTOMATION_TESTS
#include "Camera/PlayerCameraManager.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "InputKeyEventArgs.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/ConfigCacheIni.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "SailingPlayerController.h"
#include "SailingExplorer.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "SailingWallet.h"
#include "Slate/SceneViewport.h"
#include "UnrealClient.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingCrabStacksTest, "Sailing.Voyage.CrabStacks",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)

bool FSailingCrabStacksTest::RunTest(const FString&)
{
    auto* Wallet = NewObject<USailingWallet>(NewObject<UGameInstance>(GEngine));
    for (int32 Index = 0; Index < 101; ++Index)
    {
        Wallet->AddCrab(ESailingCrab::Shore);
        Wallet->AddCrab(ESailingCrab::Seabed);
    }
    const auto Stacks = Wallet->Crabs();
    if (TestEqual(TEXT("Catch uses independent stacks for the two habitats"), Stacks.Num(), 4))
    {
        TestTrue(TEXT("Each crab fills its own stack up to 100"),
            Stacks[0].Kind == ESailingCrab::Shore && Stacks[1].Kind == ESailingCrab::Seabed &&
            Stacks[0].Count == 100 && Stacks[1].Count == 100 && Stacks[2].Count == 1 && Stacks[3].Count == 1);
    }
    TestEqual(TEXT("The sale pays more per seabed crab"), Wallet->SellCrabs(), 404);
    TestTrue(TEXT("The sale credits the wallet and clears the catch"), Wallet->Balance() == 404 && Wallet->Crabs().IsEmpty());
    TestEqual(TEXT("A second sale cannot pay for the same crabs again"), Wallet->SellCrabs(), 0);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingCrabPickupTest, "Sailing.Voyage.CrabPickup",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingCrabPickupTest::RunTest(const FString&)
{
    auto* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    auto* Yacht = Player ? Player->GetPawn<ASailingYachtPawn>() : nullptr;
    if (!TestNotNull(TEXT("A live yacht and its crab populations"), Yacht)) return false;
    auto& Explorer = Yacht->Explorer();
    auto& Crabs = Yacht->Crabs();
    const auto Tap = [Player](FKey Key) {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, IE_Pressed, 1));
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, IE_Released, 0));
    };
    const auto Approach = [&](FVector Feet, bool bShore) {
        Explorer.Arrive(*Yacht, Feet, bShore);
        Player->PlayerCameraManager->UpdateCamera(0.0f);
        Crabs.Advance(*Yacht, .1f);
    };
    if (!Explorer.Away()) Tap(EKeys::T);
    for (bool bShore : {true, false})
    {
        const FVector Bank = bShore ? FVector(32000, 8200, 220) : FVector(1400, 1500, -170);
        const ESailingCrab Kind = bShore ? ESailingCrab::Shore : ESailingCrab::Seabed;
        Approach(Bank, bShore);
        FVector Crab;
        if (!TestTrue(TEXT("The habitat contains a live crab"), Crabs.Nearest(!bShore, Bank, Crab))) continue;
        Approach(Crab + FVector(0, 0, bShore ? 0. : 60.), bShore);
        const FVector Reach = bShore ? Explorer.ShoreFooting() : Explorer.GetComponentLocation();
        TestTrue(TEXT("A nearby crab shows the collect prompt"),
            FString(Explorer.Prompt(*Yacht)).Contains(TEXT("Collect")));
        const int32 OldValue = Player->Wallet().CrabSaleValue();
        Tap(EKeys::E);
        TestEqual(TEXT("E adds the crab to the correct inventory stack"),
            Player->Wallet().CrabSaleValue() - OldValue, USailingWallet::CrabPrice(Kind));
        TestFalse(TEXT("The collected crab leaves the scene immediately"), Crabs.CanCollect(Kind, Reach));
        Approach(Bank + FVector(5100, 5100, 0), bShore);
        Approach(Crab + FVector(0, 0, bShore ? 0. : 60.), bShore);
        TestFalse(TEXT("Leaving the cell and returning cannot collect it again"), Crabs.CanCollect(Kind, Reach));
    }
    Tap(EKeys::T);
    auto* Wallet = Player->GetGameInstance()->GetSubsystem<USailingWallet>();
    Wallet->Spend(Wallet->SellCrabs());
    return true;
}

namespace
{
class FInspectDeckPanels final : public IAutomationLatentCommand
{
public:
    FInspectDeckPanels(ASailingPlayerController& InPlayer, FAutomationTestBase& InTest) : Player(&InPlayer), Test(InTest)
    {
        FParse::Value(FCommandLine::Get(), TEXT("SailingDeckShots="), Shots);
    }

    bool Update() override
    {
        if (!Player.IsValid()) return true;
        const double Now = FPlatformTime::Seconds();
        if (Now < Next) return false;
        Next = Now + .43;
        const auto CheckPaused = [&](const TCHAR* Label, ESailingPausePage Page) {
            Test.TestTrue(Label, Player->GetPanel() == ESailingPanel::Pause && Player->PausePage() == Page &&
                UGameplayStatics::IsGamePaused(Player.Get()));
        };
        switch (Stage++)
        {
        case 0:
            Tap(EKeys::Escape);
            CheckPaused(TEXT("Escape opens the pause menu and pauses time"), ESailingPausePage::Menu);
            break;
        case 1:
            Photo(TEXT("pause.png"));
            break;
        case 2:
            Player->OpenPausePage(ESailingPausePage::Graphics);
            CheckPaused(TEXT("Graphics settings open within the pause modal"), ESailingPausePage::Graphics);
            break;
        case 3:
            Photo(TEXT("graphics.png"));
            Tap(EKeys::Tab);
            Test.TestTrue(TEXT("Inventory opens from a paused settings page without advancing the world"),
                Player->GetPanel()==ESailingPanel::Gear && UGameplayStatics::IsGamePaused(Player.Get()));
            Tap(EKeys::Tab);
            CheckPaused(TEXT("Inventory restores the same paused settings page"),ESailingPausePage::Graphics);
            break;
        case 4:
            Tap(EKeys::Escape);
            CheckPaused(TEXT("Back returns from graphics to the pause menu"), ESailingPausePage::Menu);
            Player->OpenPausePage(ESailingPausePage::Sound);
            CheckPaused(TEXT("The sound mixer shares the pause modal"), ESailingPausePage::Sound);
            CheckMixer();
            break;
        case 5:
            Photo(TEXT("sound.png"));
            break;
        case 6:
#if PLATFORM_MAC
            Player->OpenPausePage(ESailingPausePage::Music);
            CheckPaused(TEXT("The music library is nested under sound"), ESailingPausePage::Music);
#endif
            break;
        case 7:
#if PLATFORM_MAC
            Photo(TEXT("music.png"));
#endif
            break;
        case 8:
#if PLATFORM_MAC
            Tap(EKeys::Escape);
            CheckPaused(TEXT("Back from the library returns to the mixer"), ESailingPausePage::Sound);
#endif
            Tap(EKeys::Escape);
            CheckPaused(TEXT("Back from sound returns to the pause menu"), ESailingPausePage::Menu);
            Tap(EKeys::Escape);
            Test.TestTrue(TEXT("Escape from the main modal resumes play"), Player->GetPanel() == ESailingPanel::None &&
                !UGameplayStatics::IsGamePaused(Player.Get()));
            Tap(EKeys::Tab);
            Test.TestTrue(TEXT("Tab opens the inventory directly with the air tank selected"),
                Player->GetPanel() == ESailingPanel::Gear && Player->SelectedGear() == ESailingGear::Tank);
            for (int32 Index = 0; Index < FSailingCrabStack::Capacity; ++Index)
                Player->GetGameInstance()->GetSubsystem<USailingWallet>()->AddCrab(ESailingCrab::Shore);
            Player->GetGameInstance()->GetSubsystem<USailingWallet>()->AddCrab(ESailingCrab::Seabed);
            break;
        case 9:
            if (const auto* HUD = Cast<ASailingTrialHUD>(Player->GetHUD()))
            {
                for (int32 Slot = 1; Slot <= 4; ++Slot)
                    Test.TestNotNull(TEXT("Portable gear has a selectable slot"), HUD->GetHitBoxWithName(FName(TEXT("GearEntry"), Slot)));
                Test.TestNull(TEXT("The former horn slot is empty"), HUD->GetHitBoxWithName(FName(TEXT("GearEntry"), 5)));
                Test.TestNull(TEXT("The former bell slot is empty"), HUD->GetHitBoxWithName(FName(TEXT("GearEntry"), 6)));
            }
            else Test.AddError(TEXT("The inventory HUD is missing"));
            Photo(TEXT("inventory.png"));
            break;
        case 10:
            {
                auto* Wallet = Player->GetGameInstance()->GetSubsystem<USailingWallet>();
                const int32 Balance = Wallet->Balance(), Value = Wallet->CrabSaleValue();
                const auto* Hud = Cast<ASailingTrialHUD>(Player->GetHUD());
                const auto* Button = Hud ? Hud->GetHitBoxWithName(TEXT("SellCrabs")) : nullptr;
                if (Test.TestNotNull(TEXT("The catch has a sell button"), Button)) Click(*Button);
                Test.TestTrue(TEXT("The sell button credits the displayed price and empties the catch"),
                    Wallet->Balance() == Balance + Value && Wallet->Crabs().IsEmpty());
                Wallet->SellCrabs();
                Wallet->Spend(Value);
            }
            Tap(EKeys::Right);
            Test.TestTrue(TEXT("Right selects the torch in the equipment row"),
                Player->SelectedGear() == ESailingGear::Torch && !Player->CanUseGear());
            Tap(EKeys::Down);
            Test.TestTrue(TEXT("Down selects the signal in the corresponding column"),
                Player->SelectedGear() == ESailingGear::GreenFlare && Player->CanUseGear());
            Tap(EKeys::Right);
            Test.TestEqual(TEXT("Keyboard selection ends at the green flare"), Player->SelectedGear(), ESailingGear::GreenFlare);
            Tap(EKeys::Q);
            Test.TestTrue(TEXT("The chart still opens from inventory"), Player->GetPanel() == ESailingPanel::Chart);
            Tap(EKeys::F);
            Test.TestFalse(TEXT("Fit changes the chart to an overview instead of tracking the player"),
                Player->ChartView().bFollowing);
            break;
        case 11:
            {
                const FVector2D Start = Player->ChartView().Center;
                ChartGesture({96., 24.});
                Test.TestTrue(TEXT("Dragging pans the chart without creating a waypoint"),
                    FVector2D::Distance(Start, Player->ChartView().Center) > 10. && !Player->ChartView().HasWaypoint());
                Tap(EKeys::F);
            }
            ChartGesture(FVector2D::ZeroVector);
            Test.TestTrue(TEXT("A click on the chart sets a waypoint"), Player->ChartView().HasWaypoint());
            break;
        case 12:
            Photo(TEXT("chart.png"));
            break;
        case 13:
        {
            const auto* Hud=Cast<ASailingTrialHUD>(Player->GetHUD());
            const auto* Button=Hud ? Hud->GetHitBoxWithName(TEXT("FastTravel")) : nullptr;
            if (Test.TestNotNull(TEXT("The map has a fast travel button"),Button) &&
                Test.TestTrue(TEXT("The pin has a clear landing"),Player->ChartView().Arrival().IsSet()))
            {
                const FVector Expected=*Player->ChartView().Arrival();
                const int32 Before=Player->Coins();
                Test.TestEqual(TEXT("A test voyage starts with the configured purse"),Before,1000);
                Click(*Button);
                Test.TestEqual(TEXT("Successful travel charges one fare"),Player->Coins(),Before-ASailingPlayerController::TravelFare);
                Test.TestTrue(TEXT("The yacht arrives at the previewed water"),FVector::Dist2D(
                    Player->GetPawn()->GetActorLocation(),Expected)<1.);
                if (Player->GetPanel()!=ESailingPanel::Chart) Tap(EKeys::Q);
            }
            ChartGesture(FVector2D::ZeroVector);
            Tap(EKeys::Escape);
            Test.TestTrue(TEXT("Closing the map leaves the waypoint set"), Player->GetPanel()==ESailingPanel::None &&
                Player->ChartView().HasWaypoint());
            Tap(EKeys::Q);
            Tap(EKeys::Delete);
            Test.TestFalse(TEXT("Delete clears a waypoint directly from the chart"), Player->ChartView().HasWaypoint());
            Tap(EKeys::Escape);
            Tap(EKeys::J);
            Test.TestTrue(TEXT("The horn still works from the helm"), Player->NoticeText().StartsWith(TEXT("Horn")));
            Tap(EKeys::B);
            Test.TestTrue(TEXT("The bell still works from the helm"), Player->NoticeText().StartsWith(TEXT("Bell")));
            return true;
        }
        default: return true;
        }
        return false;
    }

private:
    void CheckMixer()
    {
        auto& Sound = Player->Sound();
        const auto Music = ESailingAudioBus::Music, World = ESailingAudioBus::World, Engine = ESailingAudioBus::Engine;
        const float InitialMusic = Sound.Volume(Music), InitialWorld = Sound.Volume(World), InitialEngine = Sound.Volume(Engine);
        Sound.SetVolume(Music, .32f);
        Sound.SetVolume(World, .75f);
        Sound.SetVolume(Engine, .52f);
        Test.TestTrue(TEXT("Music, world and engine volume settings are independent"),
            Sound.Volume(Music) == .32f && Sound.Volume(World) == .75f && Sound.Volume(Engine) == .52f);
        Sound.SavePreferences();
        float Volume = 0;
        GConfig->GetFloat(TEXT("Sailing.Sound"), TEXT("Engine"), Volume, GGameUserSettingsIni);
        Test.TestEqual(TEXT("The mixer saves the selected engine level"), Volume, .52f);
        Sound.SetVolume(Music, InitialMusic);
        Sound.SetVolume(World, InitialWorld);
        Sound.SetVolume(Engine, InitialEngine);
    }

    void Tap(FKey Key)
    {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, IE_Pressed, 1));
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key, IE_Released, 0));
    }

    void Click(const FHUDHitBox& Button)
    {
        auto* View = Player->GetWorld()->GetGameViewport()->GetGameViewport();
        const FVector2D Pixels(View->GetSizeXY());
        for (int32 Y = 0; Y < Pixels.Y; Y += 8)
        for (int32 X = 0; X < Pixels.X; X += 8)
        {
            const FVector2D Position(X, Y);
            if (!Button.Contains(Position)) continue;
            const FGeometry Geometry = FGeometry::MakeRoot(Pixels, FSlateLayoutTransform());
            const TSet<FKey> Buttons{EKeys::LeftMouseButton};
            const FPointerEvent Event(0, Position, Position, Buttons, EKeys::LeftMouseButton, 0, {});
            View->OnMouseButtonDown(Geometry, Event);
            View->OnMouseButtonUp(Geometry, Event);
            return;
        }
    }

    void ChartGesture(FVector2D Drag)
    {
        auto* HUD = Cast<ASailingTrialHUD>(Player->GetHUD());
        FSceneViewport* View = Player->GetWorld()->GetGameViewport()->GetGameViewport();
        if (!HUD || !View) return;
        const FVector2D Pixels(View->GetSizeXY());
        const auto Area = FSailingChart::Plot(Pixels / HUD->InputScale());
        const FVector2D Position = (Area.GetCenter() + FVector2D(65., 30.)) * HUD->InputScale();
        const FGeometry Geometry = FGeometry::MakeRoot(Pixels, FSlateLayoutTransform());
        const TSet<FKey> Buttons{EKeys::LeftMouseButton};
        View->OnMouseButtonDown(Geometry, FPointerEvent(0, Position, Position, Buttons, EKeys::LeftMouseButton, 0, {}));
        const FVector2D End = Position + Drag * HUD->InputScale();
        View->OnMouseButtonUp(Geometry, FPointerEvent(0, End, Position, Buttons, EKeys::LeftMouseButton, 0, {}));
    }

    void Photo(const TCHAR* File) const
    {
        if (!Shots.IsEmpty()) FScreenshotRequest::RequestScreenshot(FPaths::Combine(Shots, File), true, false);
    }

    TWeakObjectPtr<ASailingPlayerController> Player;
    FAutomationTestBase& Test;
    FString Shots;
    double Next = 0.;
    int32 Stage = 0;
};
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingDeckPanelsTest, "Sailing.Controls.DeckPanels",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)

bool FSailingDeckPanelsTest::RunTest(const FString&)
{
    auto* World = GEngine->GameViewport ? GEngine->GameViewport->GetWorld() : nullptr;
    auto* Player = World ? Cast<ASailingPlayerController>(World->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("A playable voyage"), Player)) return false;
    ADD_LATENT_AUTOMATION_COMMAND(FInspectDeckPanels(*Player, *this));
    return true;
}
#endif
