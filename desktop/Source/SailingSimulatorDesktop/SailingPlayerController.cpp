#include "SailingPlayerController.h"

#include "SailingExplorer.h"
#include "SailingSignal.h"
#include "SailingVoyageSound.h"
#include "GameFramework/HUDHitBox.h"
#include "InputKeyEventArgs.h"
#include "Kismet/GameplayStatics.h"
#include "SailingTrial.h"
#include "SailingWeather.h"
#include "SailingWorldPanel.h"
#include "SailingViewportClient.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/GameUserSettings.h"
#include "HAL/IConsoleManager.h"
#include "Misc/ConfigCacheIni.h"
#include "RenderResource.h"
#include "RenderUtils.h"
#include "RHI.h"
#include "Scalability.h"
#include "UnrealClient.h"
#include "Widgets/SViewport.h"
#include "Widgets/SWindow.h"

#include "Framework/Application/IInputProcessor.h"
#include "Kismet/KismetSystemLibrary.h"
#include "SailingWallet.h"
#if PLATFORM_MAC
#include "Mac/MacSystemIncludes.h"
#endif

class FSailingGameKeyboard final : public IInputProcessor
{
public:
    explicit FSailingGameKeyboard(ASailingPlayerController* InPlayer) : Player(InPlayer) {}
    void SetFocusTargets(TSharedPtr<SWidget> Viewport, TSharedPtr<SWidget> Settings)
    {
        GameViewport = Viewport;
        WorldPanel = Settings;
    }

    void Tick(float, FSlateApplication&, TSharedRef<ICursor>) override {}
    bool HandleKeyDownEvent(FSlateApplication& Slate, const FKeyEvent& Event) override
    {
        const auto Focus = Slate.GetUserFocusedWidget(Event.GetUserIndex());
        const auto Settings = WorldPanel.Pin();
        const auto Game = GameViewport.Pin();
        const bool bGameFocus = Focus && ((Game && (Focus == Game || Game->HasUserFocusedDescendants(Event.GetUserIndex()))) ||
            (Settings && (Focus == Settings || Settings->HasUserFocusedDescendants(Event.GetUserIndex()))));
        if (Player.IsValid() && bGameFocus && !Event.GetModifierKeys().AnyModifiersDown() &&
            (Event.GetKey() == EKeys::Tab || (Event.GetKey() == EKeys::Escape && Player->GetPanel() == ESailingPanel::Gear)))
        {
            if (!Event.IsRepeat()) Player->ToggleInventory();
            return true;
        }
        return RouteUnmappedKey(Slate, Event, true);
    }

    bool HandleKeyUpEvent(FSlateApplication& Slate, const FKeyEvent& Event) override
    {
        return RouteUnmappedKey(Slate, Event, false);
    }

private:
    TWeakObjectPtr<ASailingPlayerController> Player;
#if PLATFORM_MAC
    static FKey SailingKey(uint32 Code)
    {
        switch (Code)
        {
        case kVK_ANSI_A: return EKeys::A;
        case kVK_ANSI_B: return EKeys::B;
        case kVK_ANSI_C: return EKeys::C;
        case kVK_ANSI_D: return EKeys::D;
        case kVK_ANSI_E: return EKeys::E;
        case kVK_ANSI_F: return EKeys::F;
        case kVK_ANSI_G: return EKeys::G;
        case kVK_ANSI_H: return EKeys::H;
        case kVK_ANSI_J: return EKeys::J;
        case kVK_ANSI_L: return EKeys::L;
        case kVK_ANSI_M: return EKeys::M;
        case kVK_ANSI_N: return EKeys::N;
        case kVK_ANSI_O: return EKeys::O;
        case kVK_ANSI_P: return EKeys::P;
        case kVK_ANSI_Q: return EKeys::Q;
        case kVK_ANSI_R: return EKeys::R;
        case kVK_ANSI_S: return EKeys::S;
        case kVK_ANSI_T: return EKeys::T;
        case kVK_ANSI_V: return EKeys::V;
        case kVK_ANSI_W: return EKeys::W;
        case kVK_ANSI_X: return EKeys::X;
        case kVK_ANSI_Y: return EKeys::Y;
        case kVK_ANSI_Z: return EKeys::Z;
        case kVK_ANSI_0: return EKeys::Zero;
        case kVK_ANSI_1: return EKeys::One;
        case kVK_ANSI_2: return EKeys::Two;
        case kVK_ANSI_3: return EKeys::Three;
        case kVK_ANSI_4: return EKeys::Four;
        case kVK_ANSI_Comma: return EKeys::Comma;
        default: return EKeys::Invalid;
        }
    }

    bool RouteUnmappedKey(FSlateApplication& Slate, const FKeyEvent& Event, bool bDown) const
    {
        // Slate makes non-bindable character keys for unrecognized letters.
        // Send the physical binding through the same focus path as a mapped key.
        if (Event.GetKey().IsBindableToActions() || (bDown && (Event.IsCommandDown() || Event.IsAltDown()))) return false;
        const uint32 User = Event.GetUserIndex();
        const auto Focused = Slate.GetUserFocusedWidget(User);
        if (!Focused) return false;
        const auto Settings = WorldPanel.Pin();
        if (Focused != GameViewport.Pin() && !(Settings && (Focused == Settings || Settings->HasUserFocusedDescendants(User))))
            return false;
        const FKey Key = SailingKey(Event.GetKeyCode());
        if (!Key.IsValid()) return false;
        const FKeyEvent Normalized(Key, Event.GetModifierKeys(), Event.GetInputDeviceId(), Event.IsRepeat(),
            0, Event.GetKeyCode(), int32(User));
        if (bDown) Slate.ProcessKeyDownEvent(Normalized);
        else Slate.ProcessKeyUpEvent(Normalized);
        return true;
    }

#else
    bool RouteUnmappedKey(FSlateApplication&, const FKeyEvent&, bool) const { return false; }
#endif
    TWeakPtr<SWidget> GameViewport;
    TWeakPtr<SWidget> WorldPanel;
};

ASailingPlayerController::ASailingPlayerController()
{
    bShowMouseCursor = true;
    VoyageSound = CreateDefaultSubobject<USailingVoyageSound>(TEXT("VoyageAudio"));
}

void ASailingPlayerController::BeginPlay()
{
    Super::BeginPlay();
    if (!IsLocalController()) return;
    if (FSlateApplication::IsInitialized())
    {
        GameKeyboard = MakeShared<FSailingGameKeyboard>(this);
        FSlateApplication::Get().RegisterInputPreProcessor(GameKeyboard, 0);
    }
    UpdatePointerMode();
    Weather = Cast<ASailingWeather>(UGameplayStatics::GetActorOfClass(this, ASailingWeather::StaticClass()));
    int32 SavedQuality=0;
    GConfig->GetInt(TEXT("Sailing.World"),TEXT("Graphics"),SavedQuality,GGameUserSettingsIni);
    ApplyGraphics(SavedQuality);
    VoyageSound->LoadPreferences();
}

void ASailingPlayerController::EndPlay(const EEndPlayReason::Type Reason)
{
    if (GameKeyboard && FSlateApplication::IsInitialized())
        FSlateApplication::Get().UnregisterInputPreProcessor(GameKeyboard);
    GameKeyboard.Reset();
    if (SettingsWidget.IsValid() && GetWorld()->GetGameViewport())
        GetWorld()->GetGameViewport()->RemoveViewportWidgetContent(SettingsWidget.ToSharedRef());
    SettingsWidget.Reset();
    Super::EndPlay(Reason);
}

void ASailingPlayerController::ApplyGraphics(int32 Choice)
{
    struct FProfile
    {
        int32 ScalabilityLevel;
        float Min, Max;
        float NaniteEdge;
        int32 FogCell, FogLayers, CloudShadow, ShadowSamples, SkySamples, ReflectionSamples;
    };
    constexpr FProfile Profiles[] = {
        {2, 66.67f,100,1.2f, 12,64,128,24,52,32}, // Auto
        {0, 52,72,2.5f,      16,48,96,16,32,16},  // Low
        {1, 58,84,1.6f,      14,64,128,24,48,24}, // Medium
        {2, 72,100,1.f,      10,80,224,32,64,40}, // High
#if PLATFORM_MAC
        // Resolve the sky and sea mist at lower frequency than the water
        // normals. The 4K display composite shares the GPU frame budget.
        {3, 58,100,.83f,     14,64,144,20,40,18}  // Ultra on Metal
#else
        {3, 64,100,.83f,     10,80,224,28,56,28}  // Ultra
#endif
    };
    GraphicsChoice=FMath::Clamp(Choice,0,4);
    const FProfile& P=Profiles[GraphicsChoice];
    auto Quality = Scalability::GetQualityLevels();
    const float ResolutionQuality = Quality.ResolutionQuality;
    Quality.SetFromSingleQualityLevel(P.ScalabilityLevel);
    Quality.ResolutionQuality = ResolutionQuality;
    if (P.ScalabilityLevel == 1) Quality.GlobalIlluminationQuality = 0;
    Scalability::SetQualityLevels(Quality);

    const auto Set=[](const TCHAR* Name,auto Value) {
        if (auto* Var=IConsoleManager::Get().FindConsoleVariable(Name)) Var->Set(Value,ECVF_SetByGameOverride);
    };
    Set(TEXT("r.DynamicRes.MinScreenPercentage"),P.Min);
    Set(TEXT("r.DynamicRes.MaxScreenPercentage"),P.Max);
    const bool bDetailedWater = P.ScalabilityLevel >= 2;
    const bool bUltra = P.ScalabilityLevel == 3;
#if PLATFORM_MAC
    if (auto* Viewport=Cast<USailingViewportClient>(GetWorld()->GetGameViewport()))
        Viewport->SetAdaptiveUltra(bUltra && GetWorld()->WorldType==EWorldType::Game);
#endif
    const float BudgetMs = PLATFORM_MAC && bUltra ? 16.67f : bDetailedWater ? 33.33f : 16.67f;
    Set(TEXT("r.DynamicRes.FrameTimeBudget"),BudgetMs);
    Set(TEXT("r.Water.SingleLayer.Reflection"),bUltra ? 1 : bDetailedWater ? 3 : 2);
    Set(TEXT("r.SSR.Quality"),bUltra ? 4 : GraphicsChoice == 3 ? 3 : P.ScalabilityLevel > 0 ? 2 : 0);
    Set(TEXT("r.Shadow.Virtual.SMRT.SamplesPerRayDirectional"),bUltra ? 6 : bDetailedWater ? 4 : 2);
    Set(TEXT("r.Lumen.ScreenProbeGather.RadianceCache.NumProbesToTraceBudget"),bUltra ? 48 : GraphicsChoice == 3 ? 40 : 32);
    // The translucent shore, spray and opaque beach share the same sky lighting.
    // Spend the high-frequency samples on moving water and leaf silhouettes.
    Set(TEXT("r.Lumen.TranslucencyVolume.ShareRadianceCacheWithOpaque"),1);
    Set(TEXT("r.Lumen.ScreenProbeGather.RadianceCache.ProbeResolution"),16);
    Set(TEXT("r.Lumen.ScreenProbeGather.ShortRangeAO.DownsampleFactor"),2);
    Set(TEXT("r.Lumen.Reflections.ScreenSpaceReconstruction.NumSamples"),3);
    Set(TEXT("r.Lumen.Reflections.DownsampleFactor"),2);
    Set(TEXT("r.Lumen.ScreenProbeGather.DownsampleFactor"),bDetailedWater ? 24 : 32);
    Set(TEXT("r.Water.SingleLayer.RefractionDownsampleFactor"),2);
    Set(TEXT("r.Shadow.Virtual.SMRT.RayCountDirectional"),bDetailedWater ? 4 : 2);
    Set(TEXT("r.Nanite.MaxPixelsPerEdge"),P.NaniteEdge);
    Set(TEXT("r.VolumetricFog.GridPixelSize"),P.FogCell);
    Set(TEXT("r.VolumetricFog.GridSizeZ"),P.FogLayers);
    Set(TEXT("r.VolumetricCloud.ShadowMap.MaxResolution"),P.CloudShadow);
    Set(TEXT("r.VolumetricCloud.ShadowMap.RaySampleMaxCount"),P.ShadowSamples);
    Set(TEXT("r.VolumetricCloud.ViewRaySampleMaxCount"),P.SkySamples);
    Set(TEXT("r.VolumetricCloud.ReflectionRaySampleMaxCount"),P.ReflectionSamples);
    if (GetWorld()->WorldType == EWorldType::Game && GIsRHIInitialized)
    {
        const bool bSupportsLumenRT = GRHISupportsInlineRayTracing ||
            (GRHISupportsRayTracingShaders && GRHISupportsRayTracingDispatchIndirect);
        const auto Mode = GetRayTracingMode();
        // Metal reconstructs water reflections with the screen-space / Lumen fallback.
        const bool bHardwareRT = !PLATFORM_MAC && bUltra && bSupportsLumenRT && (Mode == ERayTracingMode::Dynamic || IsRayTracingEnabled());
        if (Mode == ERayTracingMode::Dynamic) Set(TEXT("r.RayTracing.Enable"),int32(bHardwareRT));
        Set(TEXT("r.Lumen.HardwareRayTracing"),int32(bHardwareRT && IsRayTracingEnabled()));
    }
    if (Weather) Weather->SetGraphicsQuality(P.ScalabilityLevel);
}

bool ASailingPlayerController::WorldChoiceSelected(EWorldSetting Row,int32 Index) const
{
    const auto* Yacht=GetPawn<ASailingYachtPawn>();
    switch (Row)
    {
    case EWorldSetting::Lighting: return Weather && Weather->LightingChoice()==Index;
    case EWorldSetting::Weather: return Weather && Weather->WeatherChoice()==Index;
    case EWorldSetting::Graphics: return GraphicsChoice==Index;
    case EWorldSetting::Camera: return Yacht && int32(Yacht->CurrentView())==Index;
    case EWorldSetting::Audio: return (Index==0 && VoyageSound->Enabled()) || (Index==1 && VoyageSound->EngineAudible());
    }
    return false;
}

void ASailingPlayerController::SetWorldChoice(EWorldSetting Row,int32 Index)
{
    if (Panel != ESailingPanel::World &&
        !(Panel == ESailingPanel::Pause && Pause == ESailingPausePage::Graphics && Row == EWorldSetting::Graphics)) return;
    switch (Row)
    {
    case EWorldSetting::Lighting: if (Weather) Weather->SelectLighting(Index); break;
    case EWorldSetting::Weather: if (Weather) Weather->SelectWeather(Index); break;
    case EWorldSetting::Graphics:
        ApplyGraphics(Index);
        GConfig->SetInt(TEXT("Sailing.World"),TEXT("Graphics"),GraphicsChoice,GGameUserSettingsIni);
        GEngine->GetGameUserSettings()->SaveSettings();
        break;
    case EWorldSetting::Camera:
        if (auto* Yacht=GetPawn<ASailingYachtPawn>(); Yacht && !Yacht->Explorer().Away() && Index>=0 && Index<4)
            Yacht->SelectView(static_cast<EYachtView>(Index));
        break;
    case EWorldSetting::Audio:
        if (Index==0) VoyageSound->Toggle();
        else if (Index==1) VoyageSound->ToggleEngineAudio();
        else if (Index==2 || Index==3) VoyageSound->Tune(Index==2 ? -1 : 1);
        break;
    }
}

bool ASailingPlayerController::CanChangeResolution() const
{
    const auto* Viewport = Cast<USailingViewportClient>(GetWorld()->GetGameViewport());
    return GetWorld()->WorldType == EWorldType::Game && Viewport && Viewport->Viewport &&
        Viewport->GetWindow().IsValid() && FSlateApplication::IsInitialized();
}

FIntPoint ASailingPlayerController::WorldResolution() const
{
    const auto* Client = Cast<USailingViewportClient>(GetWorld()->GetGameViewport());
    return Client ? Client->RenderResolution() : FIntPoint::ZeroValue;
}

Sailing::FDisplayModes ASailingPlayerController::WorldDisplayModes() const
{
    if (!CanChangeResolution()) return {};
    const auto* Client = GetWorld()->GetGameViewport();
    return Sailing::ReadDisplayModes(*Client->Viewport,*Client->GetWindow());
}

void ASailingPlayerController::SetWorldResolution(FIntPoint Size)
{
    if (Panel != ESailingPanel::World && !(Panel == ESailingPanel::Pause && Pause == ESailingPausePage::Graphics)) return;
    if (!CanChangeResolution() || (Size != FIntPoint::ZeroValue && !WorldDisplayModes().Sizes.Contains(Size))) return;
    CastChecked<USailingViewportClient>(GetWorld()->GetGameViewport())->SetRenderResolution(Size);
}

FString ASailingPlayerController::WorldReadout() const
{
    const auto* Yacht=GetPawn<ASailingYachtPawn>();
    if (!Yacht || !Weather) return {};
    const auto Sea=Yacht->SeaFrame();
    const auto* Viewport=Cast<USailingViewportClient>(GetWorld()->GetGameViewport());
    return FString::Printf(TEXT("%s   ·   %.0f FPS   ·   Waves %.1f m   ·   Wind %.0f kn"),
        Weather->ClimateName(),Viewport ? Viewport->FramesPerSecond() : 0.f,Sailing::SignificantWaveHeight(Sea.Scale),
        Sailing::TrueWind(Sea.TimeS,Sea.Scale).Size()*Sailing::KnotsPerMps);
}

void ASailingPlayerController::ToggleWorld()
{
    if (Panel==ESailingPanel::World) { OpenPanel(WorldReturn); return; }
    WorldReturn = Panel;
    if (auto* Yacht=GetPawn<ASailingYachtPawn>()) { Yacht->SetCinematic(false); EndSignalView(*Yacht); }
    OpenPanel(ESailingPanel::World);
}

void ASailingPlayerController::UpdatePointerMode()
{
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    const bool bLook = Yacht && Yacht->Explorer().Away() && Panel == ESailingPanel::None;
    bShowMouseCursor = !bLook;
    auto* Viewport = GetWorld()->GetGameViewport();
    if (!Viewport) return;
    const TSharedPtr<SWidget> GameWidget = Viewport->GetGameViewportWidget();
    if (GameKeyboard) GameKeyboard->SetFocusTargets(GameWidget, SettingsWidget);
    const TSharedPtr<SWidget> Focus = SettingsWidget.IsValid() ? SettingsWidget : GameWidget;
    if (const auto Window = Viewport->GetWindow(); Window.IsValid() && Focus.IsValid() && GetWorld()->WorldType == EWorldType::Game)
        Window->SetWidgetToFocusOnActivate(Focus);
    if (bLook)
    {
        FInputModeGameOnly Mode;
        Mode.SetConsumeCaptureMouseDown(false);
        SetInputMode(Mode);
    }
    else
    {
        FInputModeGameAndUI Mode;
        Mode.SetHideCursorDuringCapture(false);
        Mode.SetWidgetToFocus(Focus);
        SetInputMode(Mode);
    }
}

void ASailingPlayerController::Notice(FString Message)
{
    RecentNotice = MoveTemp(Message);
    NoticeUntil = FPlatformTime::Seconds() + 2.8;
}

FString ASailingPlayerController::NoticeText() const
{
    return FPlatformTime::Seconds() < NoticeUntil ? RecentNotice : FString();
}

void ASailingPlayerController::EndSignalView(ASailingYachtPawn& Yacht)
{
    if (!SignalShot.IsValid()) return;
    SignalShot.Reset();
    SetViewTargetWithBlend(&Yacht, .25f);
}

void ASailingPlayerController::Signal(ASailingYachtPawn& Yacht, FKey Key)
{
    if (Key == EKeys::J || Key == EKeys::B)
    {
        const bool bHorn = Key == EKeys::J;
        VoyageSound->Cue(bHorn ? ESailingCue::Horn : ESailingCue::Bell);
        FString Label = bHorn ? TEXT("Horn") : TEXT("Bell");
        if (!VoyageSound->Enabled()) Label += TEXT(" · M for sound");
        Notice(MoveTemp(Label));
        return;
    }
    const float Now = GetWorld()->GetTimeSeconds();
    if (Now - LastFlareTime < 1.4f) return;
    Flares.RemoveAll([](const TWeakObjectPtr<ASailingSignal>& Flare) { return !Flare.IsValid(); });
    if (Flares.Num() >= 3)
    {
        Flares[0]->Destroy();
        Flares.RemoveAt(0);
    }
    const FVector Origin = Yacht.GetActorTransform().TransformPosition({-380, 165, 240});
    auto* Flare = GetWorld()->SpawnActor<ASailingSignal>(Origin, FRotator::ZeroRotator);
    if (!Flare) return;
    const bool bGreen = Key == EKeys::G;
    Flare->Light(bGreen, Yacht.GetActorForwardVector());
    Flares.Add(Flare);
    SignalShot = Flare;
    LastFlareTime = Now;
    SetViewTargetWithBlend(Flare, .38f);
    VoyageSound->Cue(ESailingCue::Flare);
    Notice(bGreen ? TEXT("Green flare") : TEXT("Red flare"));
}

void ASailingPlayerController::ToggleSkipper(ASailingYachtPawn& Yacht)
{
    const bool bHoldingLeftShift = bLeftShift;
    const bool bHoldingRightShift = bRightShift;
    EndSignalView(Yacht);
    Yacht.ToggleExplorer();
    FlushPressedKeys();
    UpdatePointerMode();
    if (Yacht.Explorer().Away())
    {
        // Changing mouse capture clears key state while Shift may still be held.
        bLeftShift = bHoldingLeftShift;
        bRightShift = bHoldingRightShift;
    }
}

bool ASailingPlayerController::HasShortcutModifier(bool bIgnoreControl) const
{
    return (!bIgnoreControl && (IsInputKeyDown(EKeys::LeftControl) || IsInputKeyDown(EKeys::RightControl))) ||
           IsInputKeyDown(EKeys::LeftCommand) || IsInputKeyDown(EKeys::RightCommand) ||
           IsInputKeyDown(EKeys::LeftAlt) || IsInputKeyDown(EKeys::RightAlt);
}

void ASailingPlayerController::FlushPressedKeys()
{
    Super::FlushPressedKeys();
    bLeftShift = bRightShift = false;
    Drag = EDrag::None;
    bTapCandidate = false;
    LastTapTime = -1;
    if (auto* Yacht = GetPawn<ASailingYachtPawn>()) Yacht->Explorer().ClearInput();
}

void ASailingPlayerController::OpenPanel(ESailingPanel Next)
{
    const bool bReturning = Panel == ESailingPanel::Gear && Next == GearReturn;
    const bool bPause = Next == ESailingPanel::Pause || (Next == ESailingPanel::Gear && GearReturn == ESailingPanel::Pause);
    if (bPause != IsPaused() && !SetPause(bPause)) return;
    auto* Viewport = GetWorld()->GetGameViewport();
    const bool bHadSettings = SettingsWidget.IsValid();
    if (bHadSettings && Viewport) Viewport->RemoveViewportWidgetContent(SettingsWidget.ToSharedRef());
    SettingsWidget.Reset();
    Panel = Next;
    if (Viewport && (Panel == ESailingPanel::World || Panel == ESailingPanel::Pause))
    {
        Pause = bReturning ? GearPausePage : ESailingPausePage::Menu;
        SettingsWidget = bReturning && GearPreviousSettings ? GearPreviousSettings :
            (bPause ? MakeSailingPausePanel(*this) : MakeSailingWorldPanel(*this));
        Viewport->AddViewportWidgetContent(SettingsWidget.ToSharedRef(), 25);
    }
    if (auto* Yacht = GetPawn<ASailingYachtPawn>())
    {
        Yacht->Explorer().SetFrozen(Next != ESailingPanel::None);
        if (Next == ESailingPanel::Chart) Chart.Open(*GetWorld(), *Yacht);
    }
    if (Next != ESailingPanel::None && GetHUD()) GetHUD()->bShowHUD = true;
    FlushPressedKeys();
    UpdatePointerMode();
    if (bHadSettings && !SettingsWidget.IsValid() && FSlateApplication::IsInitialized())
        FSlateApplication::Get().SetAllUserFocusToGameViewport();
    if (bReturning && GearPreviousFocus.IsValid() && FSlateApplication::IsInitialized())
        FSlateApplication::Get().SetKeyboardFocus(GearPreviousFocus.Pin(), EFocusCause::SetDirectly);
    if (Next != ESailingPanel::Gear)
    {
        GearPreviousSettings.Reset();
        GearPreviousFocus.Reset();
        GearReturn = ESailingPanel::None;
    }
}

void ASailingPlayerController::ToggleInventory()
{
    auto* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht) return;
    if (Panel == ESailingPanel::Gear)
    {
        const bool bRestoreView = bGearCinematic;
        OpenPanel(GearReturn);
        if (bRestoreView) Yacht->SetCinematic(true);
        return;
    }
    GearReturn = Panel;
    GearPausePage = Pause;
    GearPreviousSettings = SettingsWidget;
    if (FSlateApplication::IsInitialized()) GearPreviousFocus = FSlateApplication::Get().GetKeyboardFocusedWidget();
    bGearCinematic = Yacht->IsCinematic();
    if (bGearCinematic) Yacht->SetCinematic(false);
    OpenPanel(ESailingPanel::Gear);
}

void ASailingPlayerController::TravelToPin(ASailingYachtPawn& Yacht)
{
    auto* Wallet = GetGameInstance()->GetSubsystem<USailingWallet>();
    if (Panel != ESailingPanel::Chart || !Chart.Arrival() || Wallet->Balance() < TravelFare) return;
    const bool bAboard = !Yacht.Explorer().Away();
    if (!Yacht.TravelTo(*Chart.Arrival())) { Chart.RefreshArrival(Yacht); return; }
    Wallet->Spend(TravelFare);
    if (bAboard) Chart.BreakTrack();
    Chart.ClearWaypoint();
    Chart.Recenter(Yacht);
    ClosePanel();
    Notice(FString::Printf(TEXT("Arrived  ·  %d coins left"), Wallet->Balance()));
}

void ASailingPlayerController::QuitToDesktop()
{
    VoyageSound->SavePreferences();
    UKismetSystemLibrary::QuitGame(this, this, EQuitPreference::Quit, false);
}

int32 ASailingPlayerController::Coins() const
{
    return GetGameInstance()->GetSubsystem<USailingWallet>()->Balance();
}

void ASailingPlayerController::ClosePanel()
{
    if (Panel == ESailingPanel::Gear) ToggleInventory();
    else OpenPanel(ESailingPanel::None);
}

void ASailingPlayerController::OpenPausePage(ESailingPausePage Page)
{
    if (Panel != ESailingPanel::Pause || Pause == Page) return;
    if (Pause == ESailingPausePage::Sound) VoyageSound->SavePreferences();
    Pause = Page;
    UpdatePointerMode();
}

void ASailingPlayerController::BackFromPause()
{
    if (Panel != ESailingPanel::Pause) return;
    if (Pause == ESailingPausePage::Menu) ClosePanel();
    else OpenPausePage(Pause == ESailingPausePage::Music ? ESailingPausePage::Sound : ESailingPausePage::Menu);
}

bool ASailingPlayerController::CanUseGear(ESailingGear Gear) const
{
    const auto* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht) return false;
    const auto& Explorer = Yacht->Explorer();
    if (IsPaused()) return false;
    if (Gear == ESailingGear::Torch)
        return Explorer.Away() && Explorer.Mode() != ESkipperMode::Leap && Explorer.Mode() != ESkipperMode::JetSki;
    const bool bFlare = Gear == ESailingGear::RedFlare || Gear == ESailingGear::GreenFlare;
    return bFlare && !Explorer.Away() && GetWorld()->GetTimeSeconds() - LastFlareTime >= 1.4f;
}

void ASailingPlayerController::UseGear(ASailingYachtPawn& Yacht)
{
    if (Panel != ESailingPanel::Gear || !CanUseGear()) return;
    if (GearSelection == ESailingGear::Torch)
    {
        Yacht.Explorer().ToggleTorch();
        return;
    }
    const FKey Key = GearSelection == ESailingGear::RedFlare ? EKeys::F : EKeys::G;
    OpenPanel(ESailingPanel::None);
    if (Panel == ESailingPanel::None) Signal(Yacht, Key);
}

FBox2D ASailingPlayerController::ChartPlot(const ASailingTrialHUD* HUD) const
{
    int32 Width, Height;
    GetViewportSize(Width, Height);
    return FSailingChart::Plot(FVector2D(Width, Height) / (HUD ? HUD->InputScale() : 1.));
}

bool ASailingPlayerController::InputKey(const FInputKeyEventArgs& Params)
{
    const bool bHandled = Super::InputKey(Params);
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht || !IsLocalController()) return bHandled;

    const FKey Key = Params.Key;
    // A chord sees the modifier at the key event, even when its press or
    // release and O arrive between the same two player ticks.
    if (Key == EKeys::LeftShift || Key == EKeys::RightShift)
    {
        bool& Shift = Key == EKeys::LeftShift ? bLeftShift : bRightShift;
        if (Params.Event == IE_Pressed) Shift = true;
        else if (Params.Event == IE_Released) Shift = false;
        return bHandled;
    }
    USailingExplorer& Explorer = Yacht->Explorer();
    if (Explorer.Away() && Panel == ESailingPanel::None && Params.Event == IE_Axis &&
        (Key == EKeys::MouseX || Key == EKeys::MouseY))
    {
        Explorer.Look(Key == EKeys::MouseX ? Params.AmountDepressed : 0,
                      Key == EKeys::MouseY ? Params.AmountDepressed : 0);
        return true;
    }
    if (Key == EKeys::LeftMouseButton)
    {
        if (Explorer.Away() && Panel == ESailingPanel::None) return bHandled;
        FVector2D Position;
        if (Params.Viewport)
        {
            // A captured drag may end beyond the viewport. Keep the release
            // coordinates so the throttle can clamp to the end of its track.
            FIntPoint Mouse;
            Params.Viewport->GetMousePos(Mouse);
            Position = FVector2D(Mouse);
        }
        else if (!GetMousePosition(Position.X, Position.Y))
        {
            Drag = EDrag::None;
            LastTapTime = -1;
            return bHandled;
        }
        ASailingTrialHUD* HUD = Cast<ASailingTrialHUD>(GetHUD());
        if (Params.Event == IE_Released)
            ReleasePointer(Position, *Yacht, HUD);
        else if (Params.Event == IE_Pressed || Params.Event == IE_DoubleClick)
            PressPointer(Position, *Yacht, HUD);
        return true;
    }
    const bool bCrouchKey = Key == EKeys::LeftControl || Key == EKeys::RightControl;
    const bool bSwimVerticalKey = Explorer.Mode() == ESkipperMode::Swim && (Key == EKeys::SpaceBar || Key == EKeys::C);
    if (HasShortcutModifier(bSwimVerticalKey) && !(Explorer.Away() && bCrouchKey)) return bHandled;
    if (Key == EKeys::MouseWheelAxis && Params.Event == IE_Axis)
    {
        if (Panel == ESailingPanel::Chart)
        {
            const auto* HUD = Cast<ASailingTrialHUD>(GetHUD());
            const double Scale = HUD ? HUD->InputScale() : 1.;
            const FBox2D Plot = ChartPlot(HUD);
            int32 Width, Height;
            GetViewportSize(Width, Height);
            FVector2D Mouse(Width * .5, Height * .5);
            GetMousePosition(Mouse.X, Mouse.Y);
            Mouse /= Scale;
            Chart.Zoom(Params.AmountDepressed, Plot.IsInside(Mouse) ? Mouse - Plot.GetCenter() : FVector2D::ZeroVector);
        }
        else if (Panel == ESailingPanel::None && !Explorer.Away())
            Yacht->ZoomView(Params.AmountDepressed);
        return true;
    }
    if (Params.Event != IE_Pressed) return bHandled;
    if (Key == EKeys::Tab)
    {
        ToggleInventory();
        return true;
    }
    if (Panel == ESailingPanel::Pause && Key != EKeys::Escape && Key != EKeys::M) return true;
    if (Key==EKeys::Comma || (Key==EKeys::Escape && Panel==ESailingPanel::World))
    {
        ToggleWorld();
        return true;
    }
    if (Key == EKeys::Escape)
    {
        if (Panel == ESailingPanel::Pause)
            BackFromPause();
        else if (Panel != ESailingPanel::None)
            ClosePanel();
        else if (Yacht->IsCinematic())
            Yacht->SetCinematic(false);
        else if (SignalShot.IsValid())
            EndSignalView(*Yacht);
        else
            OpenPanel(ESailingPanel::Pause);
        return true;
    }
    if (Key == EKeys::M)
    {
        VoyageSound->Toggle();
        Notice(VoyageSound->Enabled() ? TEXT("Sound on") : TEXT("Sound off"));
        return true;
    }
    if (Key == EKeys::H)
    {
        Yacht->SetCinematic(false);
        if (Panel == ESailingPanel::Controls) ClosePanel();
        else OpenPanel(ESailingPanel::Controls);
        return true;
    }
    if (Key == EKeys::Q || Key == EKeys::N)
    {
        const ESailingPanel Target = ESailingPanel::Chart;
        if (Panel == ESailingPanel::World) return bHandled;
        EndSignalView(*Yacht);
        Yacht->SetCinematic(false);
        if (Panel == Target) ClosePanel();
        else OpenPanel(Target);
        return true;
    }
    if (Panel == ESailingPanel::Gear)
    {
        if (Key == EKeys::Enter)
        {
            UseGear(*Yacht);
            return true;
        }
        const int32 Current = int32(GearSelection), Signals = int32(ESailingGear::RedFlare);
        const bool bSignal = Current >= Signals;
        if (Key == EKeys::Left || Key == EKeys::Right)
        {
            const int32 Step = Key == EKeys::Right ? 1 : -1;
            GearSelection = ESailingGear(FMath::Clamp(Current + Step, bSignal ? Signals : 0,
                bSignal ? int32(ESailingGear::Count) - 1 : Signals - 1));
            return true;
        }
        if (Key == EKeys::Up || Key == EKeys::Down)
        {
            if (bSignal && Key == EKeys::Up) GearSelection = ESailingGear(FMath::Min(Current - Signals, Signals - 1));
            if (!bSignal && Key == EKeys::Down) GearSelection = ESailingGear(Current + Signals);
            return true;
        }
    }
    if (Panel == ESailingPanel::Chart)
    {
        if (Key == EKeys::R) Chart.Recenter(*Yacht);
        else if (Key == EKeys::F) Chart.Fit(ChartPlot(Cast<ASailingTrialHUD>(GetHUD())).GetSize(), *Yacht);
        else if (Key == EKeys::BackSpace || Key == EKeys::Delete) Chart.ClearWaypoint();
        else if (Key == EKeys::Enter) Chart.SetWaypoint(Chart.Center, *Yacht);
        else if (Key == EKeys::Equals || Key == EKeys::Hyphen) Chart.Zoom(Key == EKeys::Equals ? 1. : -1., FVector2D::ZeroVector);
        else if (Key == EKeys::Up || Key == EKeys::Down || Key == EKeys::Left || Key == EKeys::Right)
            Chart.Pan(FVector2D(Key == EKeys::Left ? 60. : Key == EKeys::Right ? -60. : 0.,
                               Key == EKeys::Up ? 60. : Key == EKeys::Down ? -60. : 0.));
        else if (Key == EKeys::T)
        {
            ClosePanel();
            ToggleSkipper(*Yacht);
        }
        else return bHandled;
        return true;
    }
    if (Key == EKeys::T && Panel == ESailingPanel::None)
    {
        ToggleSkipper(*Yacht);
        return true;
    }
    if (Panel != ESailingPanel::None) return bHandled;
    if (Explorer.Away())
    {
        if (Key == EKeys::E)
        {
            Explorer.Interact(*Yacht);
            if (!Explorer.Away())
            {
                FlushPressedKeys();
                UpdatePointerMode();
            }
        }
        else if (Explorer.Mode() == ESkipperMode::JetSki)
        {
            if (Key != EKeys::R) return bHandled;
            Explorer.RecenterJetSkiView();
        }
        else if (Key == EKeys::SpaceBar)
            Explorer.Jump();
        else if (Key == EKeys::C || bCrouchKey)
            Explorer.CrouchOrDive(*Yacht);
        else if (Key == EKeys::F)
            Explorer.ToggleTorch();
        else
            return bHandled;
        return true;
    }
    if (Key == EKeys::V || Key == EKeys::R || Key == EKeys::P) EndSignalView(*Yacht);
    if (Key == EKeys::J || Key == EKeys::B || Key == EKeys::F || Key == EKeys::G)
    {
        if (!Yacht->IsCinematic()) Signal(*Yacht, Key);
        return true;
    }
    if (Key == EKeys::O || Key == EKeys::Zero)
    {
        VoyageSound->Tune(bLeftShift || bRightShift ? -1 : 1);
        Notice(VoyageSound->StationLabel());
        return true;
    }
    if (Key == EKeys::V)
        Yacht->CycleView();
    else if (Key == EKeys::P)
        Yacht->SetCinematic(!Yacht->IsCinematic());
    else if (Key == EKeys::R)
        Yacht->RecenterView();
    else if (Key == EKeys::C)
        Yacht->SetRudder(0);
    else if (Key == EKeys::SpaceBar)
    {
        Yacht->SetEngineRunning(!Yacht->ReadHelm().bEngineOn);
        if (Drag == EDrag::Throttle) Drag = EDrag::None;
    }
    else if (Key == EKeys::W || Key == EKeys::Up)
        Yacht->SetEngineRunning(true);
    else if (Key == EKeys::Y)
        Yacht->ResumeAutoTrim();
    else if (Weather && Key == EKeys::L)
        Weather->RequestLightning();
    else if (Weather && Key == EKeys::One)
        Weather->SelectCondition(0);
    else if (Weather && Key == EKeys::Two)
        Weather->SelectCondition(1);
    else if (Weather && Key == EKeys::Three)
        Weather->SelectCondition(2);
    else if (Weather && Key == EKeys::Four)
        Weather->SelectCondition(3);
    else
        return bHandled;
    return true;
}

void ASailingPlayerController::PostProcessInput(float DeltaTime, bool bGamePaused)
{
    Super::PostProcessInput(DeltaTime, bGamePaused);
    ASailingYachtPawn* Yacht = GetPawn<ASailingYachtPawn>();
    if (!Yacht) return;
    if (Drag == EDrag::Chart && Panel == ESailingPanel::Chart)
    {
        FVector2D Mouse;
        if (GetMousePosition(Mouse.X, Mouse.Y)) MovePointer(Mouse, *Yacht, Cast<ASailingTrialHUD>(GetHUD()));
    }
    if (bGamePaused) return;
    USailingExplorer& Explorer = Yacht->Explorer();
    const auto& Entry = Explorer.LastWaterEntry();
    if (LastWaterEntry != Entry.Sequence)
    {
        LastWaterEntry = Entry.Sequence;
        const float Force = FMath::Clamp(Entry.ImpactCmS/650.f,.08f,1.f);
        Yacht->DisturbSurface(Entry.ContactCm,.34f*Force);
        if (Weather) Weather->SkipperSplash(*Yacht,Entry.ContactCm,Entry.VelocityCmS,Force,true);
        if (Entry.ImpactCmS >= 260.f) VoyageSound->Cue(ESailingCue::Splash);
    }
    const auto& Step = Explorer.LastFootfall();
    if (LastSplashingStep != Step.Sequence)
    {
        LastSplashingStep = Step.Sequence;
        if (Step.WaterDepthM > .05f && Step.Surface == USailingExplorer::EFootSurface::Water)
        {
            const float Force = FMath::SmoothStep(.05f,.68f,Step.WaterDepthM)*Step.Strength;
            Yacht->DisturbSurface(Step.ContactCm,.012f+.034f*Force);
            if (Weather) Weather->SkipperSplash(*Yacht,Step.ContactCm,Step.VelocityCmS,Force,false);
        }
    }
    Chart.Track(Yacht->GetActorLocation());
    if (SignalShot.IsValid() && SignalShot->Age() > 5.5f) EndSignalView(*Yacht);
    if (Panel == ESailingPanel::Chart)
    {
        if (Chart.bFollowing) Chart.Recenter(*Yacht);
    }
    if (Panel != ESailingPanel::None || (!Explorer.Away() && HasShortcutModifier()))
    {
        Yacht->DriveHelm(DeltaTime, 0, 0, 0);
        return;
    }
    const int32 Steering = int32(IsInputKeyDown(EKeys::D) || IsInputKeyDown(EKeys::Right)) -
                           int32(IsInputKeyDown(EKeys::A) || IsInputKeyDown(EKeys::Left));
    const int32 Throttle = int32(IsInputKeyDown(EKeys::W) || IsInputKeyDown(EKeys::Up)) -
                           int32(IsInputKeyDown(EKeys::S) || IsInputKeyDown(EKeys::Down));
    if (Explorer.Away())
    {
        Explorer.SetMovement(
            FVector2D(Throttle, Steering), bLeftShift || bRightShift,
            IsInputKeyDown(EKeys::SpaceBar),
            IsInputKeyDown(EKeys::C) || IsInputKeyDown(EKeys::LeftControl) || IsInputKeyDown(EKeys::RightControl));
        return;
    }
    const int32 Ease = int32(IsInputKeyDown(EKeys::Z)) - int32(IsInputKeyDown(EKeys::X));
    Yacht->DriveHelm(DeltaTime, Steering, Throttle, Ease);
    FVector2D Position;
    if (Drag != EDrag::None && GetMousePosition(Position.X, Position.Y))
    {
        MovePointer(Position, *Yacht, Cast<ASailingTrialHUD>(GetHUD()));
    }
}

bool ASailingPlayerController::PanelButton(FName Name, ASailingYachtPawn& Yacht, const ASailingTrialHUD& HUD)
{
    if (Name == TEXT("Close")) ClosePanel();
    else if (Name == TEXT("GearPage")) ToggleInventory();
    else if (Name == TEXT("FastTravel")) TravelToPin(Yacht);
    else if (Name == TEXT("ChartPage")) OpenPanel(ESailingPanel::Chart);
    else if (Name == TEXT("Follow")) Chart.Recenter(Yacht);
    else if (Name == TEXT("FitChart")) Chart.Fit(ChartPlot(&HUD).GetSize(), Yacht);
    else if (Name == TEXT("ClearWaypoint")) Chart.ClearWaypoint();
    else if (Name == TEXT("ZoomIn")) Chart.Zoom(1, FVector2D::ZeroVector);
    else if (Name == TEXT("ZoomOut")) Chart.Zoom(-1, FVector2D::ZeroVector);
    else if (Name == TEXT("UseGear")) UseGear(Yacht);
    else if (const int32 Index = Name.GetNumber() - 1; Index >= 0)
    {
        const FString Group = Name.GetPlainNameString();
        if (Group == TEXT("GearEntry") && Index < int32(ESailingGear::Count))
            GearSelection = ESailingGear(Index);
        else return false;
    }
    else return false;
    return true;
}

void ASailingPlayerController::PressPointer(FVector2D Position, ASailingYachtPawn& Yacht, ASailingTrialHUD* HUD)
{
    Drag = EDrag::None;
    PressPosition = LastPosition = Position;
    const FHUDHitBox* Box =
        HUD && HUD->bShowHUD && !Yacht.IsCinematic() ? HUD->GetHitBoxAtCoordinates(Position) : nullptr;
    const FName Name = Box ? Box->GetName() : NAME_None;
    if (Box && (Name != TEXT("Throttle") || Yacht.ReadHelm().bEngineOn))
    {
        LastTapTime = -1;
        if (Panel != ESailingPanel::None && PanelButton(Name, Yacht, *HUD)) return;
        if (Name == TEXT("World"))
            ToggleWorld();
        else if (Name == TEXT("Help"))
            OpenPanel(ESailingPanel::Controls);
        else if (Name == TEXT("Chart"))
            OpenPanel(ESailingPanel::Chart);
        else if (Panel == ESailingPanel::None)
        {
            if (Name == TEXT("Engine"))
                Yacht.SetEngineRunning(!Yacht.ReadHelm().bEngineOn);
            else if (Name == TEXT("View"))
            {
                EndSignalView(Yacht);
                Yacht.CycleView();
            }
            else if (Name == TEXT("Overboard"))
                ToggleSkipper(Yacht);
            else if (Name == TEXT("Sound"))
            {
                VoyageSound->Toggle();
                Notice(VoyageSound->Enabled() ? TEXT("Sound on") : TEXT("Sound off"));
            }
            else if (Name == TEXT("Radio"))
            {
                VoyageSound->Tune(1);
                Notice(VoyageSound->StationLabel());
            }
            else if (Name == TEXT("Horn"))
                Signal(Yacht, EKeys::J);
            else if (Name == TEXT("Bell"))
                Signal(Yacht, EKeys::B);
            else if (Name == TEXT("Red"))
                Signal(Yacht, EKeys::F);
            else if (Name == TEXT("Green"))
                Signal(Yacht, EKeys::G);
            else if (Name == TEXT("Throttle"))
            {
                Drag = EDrag::Throttle;
                Yacht.SetThrottle(HUD->ThrottleAt(Position.Y));
            }
        }
        return;
    }
    if (Panel == ESailingPanel::Chart)
    {
        if (ChartPlot(HUD).IsInside(Position / (HUD ? HUD->InputScale() : 1.)))
        {
            Drag = EDrag::Chart;
            bTapCandidate = true;
        }
        return;
    }
    if (Panel != ESailingPanel::None) return;
    EndSignalView(Yacht);
    Drag = EDrag::View;
    PressTime = FPlatformTime::Seconds();
    bTapCandidate = true;
}

void ASailingPlayerController::MovePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD)
{
    const float Scale = HUD ? HUD->InputScale() : 1.f;
    if (Drag == EDrag::Chart)
    {
        if (bTapCandidate && FVector2D::DistSquared(Position, PressPosition) <= FMath::Square(6. * Scale)) return;
        bTapCandidate = false;
        Chart.Pan((Position - LastPosition) / Scale);
    }
    else if (Drag == EDrag::View)
    {
        const float DragThreshold = (Yacht.IsCinematic() ? 10.f : 8.f) * Scale;
        if (FVector2D::DistSquared(Position, PressPosition) > FMath::Square(DragThreshold))
        {
            bTapCandidate = false;
            LastTapTime = -1;
        }
        Yacht.OrbitView((Position - LastPosition) / Scale);
    }
    else if (Drag == EDrag::Throttle)
    {
        if (HUD && Yacht.ReadHelm().bEngineOn) Yacht.SetThrottle(HUD->ThrottleAt(Position.Y));
        else Drag = EDrag::None;
    }
    LastPosition = Position;
}

void ASailingPlayerController::ReleasePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD)
{
    MovePointer(Position, Yacht, HUD);
    if (Drag == EDrag::Chart && bTapCandidate)
    {
        const FBox2D Plot = ChartPlot(HUD);
        const FVector2D Cursor = Position / (HUD ? HUD->InputScale() : 1.);
        if (Plot.IsInside(Cursor)) Chart.SetWaypoint(Chart.WorldAt(Cursor, Plot), Yacht);
    }
    else if (Drag == EDrag::View)
    {
        const double Now = FPlatformTime::Seconds();
        if (Yacht.IsCinematic())
        {
            if (bTapCandidate && Now - PressTime < .45) Yacht.SetCinematic(false);
            LastTapTime = -1;
        }
        else if (bTapCandidate && Now - PressTime <= .30)
        {
            const double TapRadius = 24.0 * (HUD ? HUD->InputScale() : 1.f);
            const bool bDoubleTap =
                Now - LastTapTime <= .35 && FVector2D::DistSquared(Position, LastTapPosition) <= TapRadius * TapRadius;
            if (bDoubleTap) Yacht.RecenterView();
            LastTapTime = bDoubleTap ? -1 : Now;
            LastTapPosition = Position;
        }
        else
            LastTapTime = -1;
    }
    Drag = EDrag::None;
}
