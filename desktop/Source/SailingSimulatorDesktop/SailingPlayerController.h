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
class SWidget;
#if PLATFORM_MAC
class FSailingMacKeyboard;
#endif

enum class ESailingPanel : uint8 { None, Controls, Pause, Chart, Gear, World };
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
    const FSailingChart& ChartView() const { return Chart; }
    const USailingVoyageSound& Sound() const { return *VoyageSound; }
    const ASailingSignal* CurrentSignal() const { return SignalShot.Get(); }
    FString NoticeText() const;
    void ToggleWorld();
    void SetWorldChoice(EWorldSetting Row, int32 Index);
    bool WorldChoiceSelected(EWorldSetting Row, int32 Index) const;
    Sailing::FDisplayModes WorldDisplayModes() const;
    FIntPoint WorldResolution() const;
    void SetWorldResolution(FIntPoint Size);
    FString WorldReadout() const;

private:
    enum class EDrag : uint8 { None, View, Throttle, Chart };
    void OpenPanel(ESailingPanel Next);
    void ApplyGraphics(int32 Choice);
    bool CanChangeResolution() const;
    TSharedPtr<SWidget> WorldWidget;
#if PLATFORM_MAC
    TSharedPtr<FSailingMacKeyboard> MacKeyboard;
#endif
    ESailingPanel WorldReturn = ESailingPanel::None;
    int32 GraphicsChoice = 0;
    void UpdatePointerMode();
    void ToggleSkipper(ASailingYachtPawn& Yacht);
    void Signal(ASailingYachtPawn& Yacht, FKey Key);
    void EndSignalView(ASailingYachtPawn& Yacht);
    void Notice(FString Message);
    void PressPointer(FVector2D Position, ASailingYachtPawn& Yacht, ASailingTrialHUD* HUD);
    void MovePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD);
    void ReleasePointer(FVector2D Position, ASailingYachtPawn& Yacht, const ASailingTrialHUD* HUD);
    bool HasShortcutModifier() const;

    UPROPERTY() TObjectPtr<ASailingWeather> Weather;
    UPROPERTY() TObjectPtr<USailingVoyageSound> VoyageSound;
    TWeakObjectPtr<ASailingSignal> SignalShot;
    TArray<TWeakObjectPtr<ASailingSignal>> Flares;
    FSailingChart Chart;
    FString RecentNotice;
    double NoticeUntil = 0;
    float LastFlareTime = -10;
    ESailingPanel Panel = ESailingPanel::None;
    EDrag Drag = EDrag::None;
    FVector2D PressPosition = FVector2D::ZeroVector;
    FVector2D LastPosition = FVector2D::ZeroVector;
    FVector2D LastTapPosition = FVector2D::ZeroVector;
    double PressTime = 0;
    double LastTapTime = -1;
    bool bTapCandidate = false;
    bool bLeaping = false;
    bool bLeftShift = false, bRightShift = false;
};
