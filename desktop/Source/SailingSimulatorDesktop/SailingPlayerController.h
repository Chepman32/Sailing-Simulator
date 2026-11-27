#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "SailingChart.h"
#include "SailingDisplay.h"
#include "SailingPlayerController.generated.h"

class ASailingTrialHUD;
class ASailingWeather;
class ASailingYachtPawn;
class ASailingSignal;
class USailingVoyageSound;
class USailingWallet;
class SWidget;
class FSailingGameKeyboard;

enum class ESailingPanel : uint8 { None, Controls, Pause, Chart, Gear, World };
enum class ESailingGear : uint8 { Tank, Torch, RedFlare, GreenFlare, Count };
enum class ESailingPausePage : uint8 { Menu, Graphics, Sound, Music };
enum class EWorldSetting : uint8 { Lighting, Weather, Audio, Graphics, Camera };

UCLASS()
class ASailingPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    ASailingPlayerController();
    void BeginPlay() override;
    void EndPlay(const EEndPlayReason::Type Reason) override;
    bool InputKey(const FInputKeyEventArgs& Params) override;
    void PostProcessInput(float DeltaTime, bool bGamePaused) override;
    void FlushPressedKeys() override;
    ESailingPanel GetPanel() const { return Panel; }
    ESailingGear SelectedGear() const { return GearSelection; }
    ESailingPausePage PausePage() const { return Pause; }
    void OpenPausePage(ESailingPausePage Page);
    void BackFromPause();
    void ToggleInventory();
    void QuitToDesktop();
    const USailingWallet& Wallet() const;
    int32 Coins() const;
    static constexpr int32 TravelFare = 10;
    static constexpr int32 CrabStacksPerPage = 4;
    int32 CrabStackPage() const { return CrabPage; }
    bool CanUseGear(ESailingGear Gear) const;
    bool CanUseGear() const { return CanUseGear(GearSelection); }
    const FSailingChart& ChartView() const { return Chart; }
    USailingVoyageSound& Sound() { return *VoyageSound; }
    const USailingVoyageSound& Sound() const { return *VoyageSound; }
    const ASailingWeather* WorldWeather() const;
    const ASailingSignal* CurrentSignal() const { return SignalShot.Get(); }
    FString NoticeText() const;
    void ToggleWorld();
    void UpdatePointerMode();
    void SetWorldChoice(EWorldSetting Row, int32 Index);
    bool WorldChoiceSelected(EWorldSetting Row, int32 Index) const;
    bool CanChangeResolution() const;
    Sailing::FDisplayModes WorldDisplayModes() const;
    FIntPoint WorldResolution() const;
    void SetWorldResolution(FIntPoint Size);
    FString WorldReadout() const;

private:
    enum class EDrag : uint8 { None, View, Throttle, Chart };
    void OpenPanel(ESailingPanel Next);
    void ClosePanel();
    void TravelToPin(ASailingYachtPawn& Yacht);
    void UseGear(ASailingYachtPawn& Yacht);
    void ChangeCrabPage(int32 Step);
    bool PanelButton(FName Name, ASailingYachtPawn& Yacht, const ASailingTrialHUD& HUD);
    FBox2D ChartPlot(const ASailingTrialHUD* HUD) const;
    void ApplyGraphics(int32 Choice);
    TSharedPtr<SWidget> SettingsWidget;
    TSharedPtr<FSailingGameKeyboard> GameKeyboard;
    ESailingPanel GearReturn = ESailingPanel::None;
    int32 CrabPage = 0;
    ESailingPausePage GearPausePage = ESailingPausePage::Menu;
    TSharedPtr<SWidget> GearPreviousSettings;
    TWeakPtr<SWidget> GearPreviousFocus;
    bool bGearCinematic = false;
    ESailingPanel WorldReturn = ESailingPanel::None;
    int32 GraphicsChoice = 0;
    void ToggleSkipper(ASailingYachtPawn& Yacht);
    void Signal(ASailingYachtPawn& Yacht, FKey Key);
    void EndSignalView(ASailingYachtPawn& Yacht);
    void Notice(FString Message);
    void PressPointer(FVector2D Position, ASailingYachtPawn& Yacht, ASailingTrialHUD* HUD);
    void MovePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD);
    void ReleasePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD);
    bool HasShortcutModifier(bool bIgnoreControl = false) const;

    UPROPERTY() TObjectPtr<ASailingWeather> Weather;
    UPROPERTY() TObjectPtr<USailingVoyageSound> VoyageSound;
    TWeakObjectPtr<ASailingSignal> SignalShot;
    TArray<TWeakObjectPtr<ASailingSignal>> Flares;
    FSailingChart Chart;
    FString RecentNotice;
    double NoticeUntil = 0;
    float LastFlareTime = -10;
    ESailingPanel Panel = ESailingPanel::None;
    ESailingGear GearSelection = ESailingGear::Tank;
    ESailingPausePage Pause = ESailingPausePage::Menu;
    EDrag Drag = EDrag::None;
    FVector2D PressPosition = FVector2D::ZeroVector;
    FVector2D LastPosition = FVector2D::ZeroVector;
    FVector2D LastTapPosition = FVector2D::ZeroVector;
    double PressTime = 0;
    double LastTapTime = -1;
    bool bTapCandidate = false;
    uint32 LastWaterEntry = 0, LastSplashingStep = 0;
    bool bLeftShift = false, bRightShift = false;
};
