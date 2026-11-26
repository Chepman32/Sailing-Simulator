#if WITH_DEV_AUTOMATION_TESTS
#include "Engine/Engine.h"
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
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "Slate/SceneViewport.h"
#include "UnrealClient.h"

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
            Tap(EKeys::Escape);
            Test.TestTrue(TEXT("Closing the chart leaves the waypoint set"), Player->GetPanel() == ESailingPanel::None &&
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
