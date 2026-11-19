#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "SailingChart.h"
#include "SailingPlayerController.generated.h"

class ASailingTrialHUD;
class ASailingWeather;
class ASailingYachtPawn;
class ASailingSignal;
class USailingVoyageSound;

enum class ESailingPanel : uint8 { None, Controls, Pause, Chart, Gear };

UCLASS()
class ASailingPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    ASailingPlayerController();
    void BeginPlay() override;
    bool InputKey(const FInputKeyEventArgs& Params) override;
    void PostProcessInput(float DeltaTime, bool bGamePaused) override;
    void FlushPressedKeys() override;
    ESailingPanel GetPanel() const { return Panel; }
    const FSailingChart& ChartView() const { return Chart; }
    const USailingVoyageSound& Sound() const { return *VoyageSound; }
    const ASailingSignal* CurrentSignal() const { return SignalShot.Get(); }
    FString NoticeText() const;

private:
    enum class EDrag : uint8 { None, View, Rudder, Throttle, Chart };
    void OpenPanel(ESailingPanel Next);
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
    double StartRudder = 0;
    double PressTime = 0;
    double LastTapTime = -1;
    bool bTapCandidate = false;
    bool bLeaping = false;
    bool bLeftShift = false, bRightShift = false;
};
