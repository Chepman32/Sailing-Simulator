#if WITH_DEV_AUTOMATION_TESTS
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "GameFramework/GameUserSettings.h"
#include "GameFramework/HUDHitBox.h"
#include "HAL/IConsoleManager.h"
#include "InputKeyEventArgs.h"
#include "Misc/AutomationTest.h"
#include "Misc/ConfigCacheIni.h"
#include "SailingPlayerController.h"
#include "SailingTrial.h"
#include "SailingVoyageSound.h"
#include "SailingWeather.h"
#include "Slate/SceneViewport.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingDisplayTest,"Sailing.Controls.DisplayModes",
    EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::EngineFilter)
bool FSailingDisplayTest::RunTest(const FString&)
{
    const TArray<FIntPoint> Reported{{5120,2880},{1920,1200},{3840,2160},{960,600},{3440,1440},
        {1280,720},{1920,1200},{4096,2160},{1366,768}};
    const TArray<FIntPoint> Wide{{1280,720},{1366,768},{1920,1200},{3440,1440},{3840,2160}};
    const TArray<FIntPoint> Laptop{{1280,720},{1366,768},{1920,1200}};
    TestTrue(TEXT("Only reported pixel modes between HD and UHD, unique across refresh rates"),
        Sailing::SelectableResolutions(Reported,{5120,2880}) == Wide);
    TestTrue(TEXT("Scaled modes beyond a smaller panel are omitted"),
        Sailing::SelectableResolutions(Reported,{1920,1200}) == Laptop);
    TestTrue(TEXT("A sub-HD display offers no invented mode"),
        Sailing::SelectableResolutions(Reported,{1024,600}).IsEmpty());
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FSailingWorldTest,"Sailing.Controls.WorldPanel",
    EAutomationTestFlags::ClientContext | EAutomationTestFlags::NonNullRHI | EAutomationTestFlags::EngineFilter)
bool FSailingWorldTest::RunTest(const FString&)
{
    auto* Client=GEngine->GameViewport.Get();
    auto* Player=Client ? Cast<ASailingPlayerController>(Client->GetWorld()->GetFirstPlayerController()) : nullptr;
    if (!TestNotNull(TEXT("Local player"),Player)) return false;
    const auto Tap=[&](FKey Key) {
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key,IE_Pressed,1));
        Player->InputKey(FInputKeyEventArgs::CreateSimulated(Key,IE_Released,0));
    };
    auto* HUD=Cast<ASailingTrialHUD>(Player->GetHUD());
    auto* View=Client->GetGameViewport();
    if (!TestNotNull(TEXT("Live HUD"),HUD) || !TestNotNull(TEXT("Live viewport"),View)) return false;
    const FVector2D Screen=FVector2D(View->GetSizeXY());
    const double Scale=HUD->InputScale();
    const double ActionY=34*Scale;
    TArray<FName> Buttons;
    double WorldX=-1.0;
    for (double X=350*Scale; X<Screen.X; X+=4*Scale)
    {
        const auto* Box=HUD->GetHitBoxAtCoordinates({X,ActionY},true);
        if (!Box) continue;
        Buttons.AddUnique(Box->GetName());
        if (Box->GetName()==TEXT("World")) WorldX=X;
    }
    const TArray<FName> Expected{TEXT("World"),TEXT("View"),TEXT("Chart"),TEXT("Help"),TEXT("Sound"),TEXT("Radio"),TEXT("Overboard")};
    if (!TestTrue(TEXT("All seven HUD actions share one row and have hit targets"),Buttons==Expected)) return false;
    View->SetMouse(FMath::RoundToInt(WorldX-12*Scale),FMath::RoundToInt(ActionY));
    Tap(EKeys::LeftMouseButton);
    if (!TestTrue(TEXT("The on-screen World button opens the settings"),Player->GetPanel()==ESailingPanel::World)) return false;
    Player->SetWorldChoice(EWorldSetting::Lighting,2);
    Player->SetWorldChoice(EWorldSetting::Weather,5);
    TestTrue(TEXT("Storm can be selected independently at night"),Player->WorldChoiceSelected(EWorldSetting::Weather,5) &&
        Player->WorldChoiceSelected(EWorldSetting::Lighting,2));
    Player->SetWorldChoice(EWorldSetting::Weather,ASailingWeather::CalmChoice);
    TestTrue(TEXT("Calm keeps the selected lighting and releases automatic weather"),
        Player->WorldChoiceSelected(EWorldSetting::Weather,ASailingWeather::CalmChoice) &&
        !Player->WorldChoiceSelected(EWorldSetting::Weather,ASailingWeather::AutoChoice) &&
        Player->WorldChoiceSelected(EWorldSetting::Lighting,2));
    Player->SetWorldChoice(EWorldSetting::Weather,7);
    TestTrue(TEXT("Automatic weather is selectable"),Player->WorldChoiceSelected(EWorldSetting::Weather,7));
    const bool Heard=Player->Sound().EngineAudible(),Master=Player->Sound().Enabled();
    Player->SetWorldChoice(EWorldSetting::Audio,1);
    TestTrue(TEXT("Engine audio is independent of the master"),Heard!=Player->Sound().EngineAudible() && Master==Player->Sound().Enabled());
    Player->SetWorldChoice(EWorldSetting::Audio,1);
    int32 Original=0;
    const bool Saved=GConfig->GetInt(TEXT("Sailing.World"),TEXT("Graphics"),Original,GGameUserSettingsIni);
    Player->SetWorldChoice(EWorldSetting::Graphics,0);
    auto& CVars = IConsoleManager::Get();
    TestEqual(TEXT("Auto budgets one thirtieth of a second for the sea"),
        CVars.FindConsoleVariable(TEXT("r.DynamicRes.FrameTimeBudget"))->GetFloat(),33.33f);
    TestEqual(TEXT("Auto reflects the yacht and land in the sea"),
        CVars.FindConsoleVariable(TEXT("r.Water.SingleLayer.Reflection"))->GetInt(),3);
    TestEqual(TEXT("Auto uses the measured sky budget above the water"),
        CVars.FindConsoleVariable(TEXT("r.VolumetricCloud.ViewRaySampleMaxCount"))->GetFloat(),52.f);
    Player->SetWorldChoice(EWorldSetting::Graphics,1);
    TestEqual(TEXT("Low graphics changes the renderer budget"),IConsoleManager::Get().FindConsoleVariable(
        TEXT("r.DynamicRes.MaxScreenPercentage"))->GetFloat(),72.f);
    TestEqual(TEXT("Low restores the faster water budget"),
        CVars.FindConsoleVariable(TEXT("r.DynamicRes.FrameTimeBudget"))->GetFloat(),16.67f);
    Player->SetWorldChoice(EWorldSetting::Graphics,Original);
    if (!Saved)
    {
        GConfig->RemoveKey(TEXT("Sailing.World"),TEXT("Graphics"),GGameUserSettingsIni);
        GConfig->Flush(false,GGameUserSettingsIni);
    }
    const auto Display = Player->WorldDisplayModes();
    TestTrue(TEXT("The game viewport identifies an active monitor and its output dimensions"),
        Display.MonitorIndex!=INDEX_NONE && Display.Desktop.GetMin()>0);
    if (!Display.Sizes.IsEmpty())
    {
        auto* Settings=GEngine->GetGameUserSettings();
        const FIntPoint OriginalSize=Player->WorldResolution();
        const FIntPoint SavedSize=Settings->GetScreenResolution();
        const auto SavedMode=Settings->GetFullscreenMode();
        const FString SavedID = Settings->GetDisplayID();
        const int32 SavedIndex = Settings->GetDisplayIndex();
        FString Listed;
        for (FIntPoint Size : Display.Sizes) Listed += FString::Printf(TEXT(" %dx%d"),Size.X,Size.Y);
        AddInfo(FString::Printf(TEXT("Display %s, desktop %dx%d, selectable:%s"),
            *Display.MonitorID,Display.Desktop.X,Display.Desktop.Y,*Listed));
        TestTrue(TEXT("Legacy window sizes below 720p stay out of the menu"), !Display.Sizes.Contains(FIntPoint(960,600)));
        const FIntPoint* Other=Display.Sizes.FindByPredicate([OriginalSize](FIntPoint Size) { return Size!=OriginalSize; });
        if (Other)
        {
            Player->SetWorldResolution(*Other);
            TestEqual(TEXT("The selection applies a new output width"),GSystemResolution.ResX,Other->X);
            TestEqual(TEXT("The selection applies a new output height"),GSystemResolution.ResY,Other->Y);
            TestEqual(TEXT("The choice is confirmed for the next launch"),Settings->GetLastConfirmedScreenResolution(),*Other);
            Player->SetWorldResolution({960,600});
            TestEqual(TEXT("An unsupported selection cannot overwrite the confirmed mode"),Settings->GetLastConfirmedScreenResolution(),*Other);
            if (Display.Sizes.Contains(Display.Desktop))
            {
                Player->SetWorldResolution(Display.Desktop);
                TestEqual(TEXT("Native fullscreen uses the active display's pixels"),
                    FIntPoint(GSystemResolution.ResX,GSystemResolution.ResY),Display.Desktop);
                TestTrue(TEXT("Native size fills the display"),Settings->GetFullscreenMode()==EWindowMode::WindowedFullscreen);
            }
            Settings->SetDisplayProperties(SavedID,SavedIndex);
            Settings->SetScreenResolution(SavedSize);
            Settings->SetFullscreenMode(SavedMode);
            Settings->ApplyResolutionSettings(false);
            Settings->ConfirmVideoMode();
            Settings->SaveSettings();
        }
    }
    Player->SetWorldChoice(EWorldSetting::Lighting,0);
    Player->SetWorldChoice(EWorldSetting::Weather,0);
    Tap(EKeys::Escape);
    TestTrue(TEXT("Escape closes the panel and returns the helm"),Player->GetPanel()==ESailingPanel::None);
    Tap(EKeys::Comma);
    TestTrue(TEXT("Comma reopens World"),Player->GetPanel()==ESailingPanel::World);
    Tap(EKeys::Comma);
    return true;
}
#endif
