#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "SailingPhysics.h"

#include <atomic>

#include "SailingTrial.generated.h"

class UBoxComponent;
class UCameraComponent;
class UInstancedStaticMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class UProceduralMeshComponent;
class USpringArmComponent;
class UStaticMeshComponent;
class ASailingWeather;
class USailingExplorer;

enum class EYachtView : uint8 { Chase, Helm, Orbit, Drone };

UCLASS()
class ASailingYachtPawn : public APawn
{
    GENERATED_BODY()

public:
    ASailingYachtPawn();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;
    void AsyncPhysicsTickActor(float DeltaSeconds, float SimTime) override;
    Sailing::FSeaFrame SeaFrame() const { return WaterFrame.load(std::memory_order_relaxed); }
    void SetSeaScale(float Scale) { SeaScale.store(Scale, std::memory_order_relaxed); }
    void SetDeckLights(float Strength);
    const Sailing::FHelm& ReadHelm() const { return Helm; }
    Sailing::FSail ReadSail() const;
    void DriveHelm(float DeltaSeconds, int32 Steering, int32 Throttle, int32 Ease);
    void SetRudder(double Value);
    void SetThrottle(double Value) { Helm.Throttle = FMath::Clamp(Value, -1.0, 1.0); }
    void SetEngineRunning(bool bRunning);
    void ResumeAutoTrim() { Helm.bAutoTrim = true; }
    void CycleView();
    void RecenterView();
    void OrbitView(FVector2D Pixels);
    void ZoomView(double WheelDelta);
    void SetCinematic(bool bEnabled);
    bool IsCinematic() const { return bCinematic; }
    const TCHAR* ViewName() const;
    USailingExplorer& Explorer() const { return *SkipperView; }
    void ToggleExplorer();
    FVector WorldFocus() const;
    double DeckFloor(FVector LocalFeet, double Top) const;
    bool DeckWall(FVector From, FVector To) const;

private:
    UPROPERTY() TObjectPtr<UBoxComponent> Hull;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> HullVisual;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> MainSail;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Catamaran;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> SkipperModel;
    UPROPERTY() TObjectPtr<USailingExplorer> SkipperView;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Rig;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Jib;
    UPROPERTY() TObjectPtr<USceneComponent> Boom;
    UPROPERTY() TObjectPtr<USpringArmComponent> ChaseArm;
    UPROPERTY() TObjectPtr<UCameraComponent> ChaseCamera;
    UPROPERTY() TObjectPtr<UCameraComponent> HelmCamera;
    UPROPERTY() TObjectPtr<UPointLightComponent> CockpitLamp;
    UPROPERTY() TObjectPtr<UPointLightComponent> PortLamp;
    UPROPERTY() TObjectPtr<UPointLightComponent> StarboardLamp;

    Sailing::FHelm Helm;
    FCriticalSection HelmMutex;
    Sailing::FHelm PhysicsHelm;
    std::atomic<Sailing::FSeaFrame> WaterFrame{Sailing::FSeaFrame{}};
    std::atomic<float> SeaScale{1.0f};
    double BoomAngle = 0.0;
    double LeewardSide = -1.0;
    void ActivateView();
    void UpdateView(float DeltaSeconds);
    EYachtView View = EYachtView::Chase;
    float ViewPitch = 0;
    float ViewYaw = 0;
    float ViewDistanceCm = 0;
    float CinematicYaw = 0;
    float CinematicPitch = 0;
    float CinematicDistanceCm = 0;
    bool bCinematic = false;
    bool bKeyboardRudder = false;
};

UCLASS()
class ASailingSea : public AActor
{
    GENERATED_BODY()

public:
    ASailingSea();
    void OnConstruction(const FTransform& Transform) override;
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;

private:
    void BuildSurface();
    void SetSurfaceFrame(Sailing::FSeaFrame Frame);

    UPROPERTY(EditAnywhere, Category = "Sea") TObjectPtr<UMaterialInterface> WaterMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> Water;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> Surface;
};

UCLASS()
class ASailingTrialHUD : public AHUD
{
    GENERATED_BODY()

public:
    void BeginPlay() override;
    void DrawHUD() override;
    double ThrottleAt(double ScreenY) const;
    float InputScale() const { return UIScale; }

private:
    UPROPERTY() TObjectPtr<ASailingWeather> Weather;
    float ThrottleTop = 0;
    float ThrottleHeight = 1;
    float UIScale = 1;
};

UCLASS()
class ASailingGrove : public AActor
{
    GENERATED_BODY()

public:
    ASailingGrove();

    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    void Plant(UStaticMesh* Tree, const TArray<FTransform>& Transforms);

private:
    UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> Palms;
};

UCLASS()
class ASailingDolphinPod : public AActor
{
    GENERATED_BODY()

public:
    ASailingDolphinPod();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;

private:
    static constexpr int32 PodSize = 3;
    UPROPERTY(EditAnywhere, Category = "Wildlife") TObjectPtr<UStaticMesh> DolphinMesh;
    UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Dolphins;
    bool bSwimming = false;
};

UCLASS()
class ASailingTrialMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ASailingTrialMode();
};
