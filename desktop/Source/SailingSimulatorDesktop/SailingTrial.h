#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
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

UCLASS()
class ASailingPlayerController : public APlayerController
{
    GENERATED_BODY()

public:
    ASailingPlayerController();
};

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

private:
    UPROPERTY() TObjectPtr<UBoxComponent> Hull;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> HullVisual;
    UPROPERTY() TObjectPtr<UProceduralMeshComponent> MainSail;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Catamaran;
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
    bool bHelmCamera = false;
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

private:
    UPROPERTY() TObjectPtr<ASailingWeather> Weather;
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
