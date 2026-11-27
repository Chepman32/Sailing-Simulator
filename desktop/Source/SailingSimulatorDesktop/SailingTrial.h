#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/HUD.h"
#include "GameFramework/Pawn.h"
#include "SailingPhysics.h"
#include "SailingShoreGuard.h"

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
class AStaticMeshActor;
class ASailingWeather;
class ASailingJetSki;
class ASailingPlayerController;
class USailingExplorer;
class USailingEntryBubbles;
class USailingMarineTraffic;
class USailingCrabs;
class ASailingSea;

enum class EYachtView : uint8 { Chase, Helm, Orbit, Drone };

struct FBowContact
{
    FVector WaterlineM = FVector::ZeroVector, StrikeM = FVector::ZeroVector;
    FVector2D FoamDriftMps = FVector2D::ZeroVector;
    float LastStrikeS = -10.f, StrikeMps = 0.f, Sheet = 0.f;
};

UCLASS()
class ASailingYachtPawn : public APawn
{
    GENERATED_BODY()

public:
    ASailingYachtPawn();
    void BeginPlay() override;
    void EndPlay(const EEndPlayReason::Type Reason) override;
    void Tick(float DeltaSeconds) override;
    void CalcCamera(float DeltaSeconds, FMinimalViewInfo& OutView) override;
    void AsyncPhysicsTickActor(float DeltaSeconds, float SimTime) override;
    Sailing::FSeaFrame SeaFrame() const { return WaterFrame.load(std::memory_order_relaxed); }
    Sailing::FBoatWake BoatWake() const;
    USailingMarineTraffic& Traffic() const { return *MarineTraffic; }
    USailingCrabs& Crabs() const { return *ShoreCrabs; }
    bool HasCoralCoast() const { return bCoralPass; }
    const Sailing::FShoreMap* ShoreGeometry() const { return ShoreMap.Get(); }
    double SurfaceHeightM(FVector2D XYm) const;
    double RenderedSurfaceHeightM(FVector2D XYm) const { return RenderedSurfaceHeightM(XYm,SeaFrame()); }
    double RenderedSurfaceHeightM(FVector2D XYm, Sailing::FSeaFrame Frame) const;
    const Sailing::FWaterImpacts& SurfaceImpacts() const { return Impacts; }
    TConstArrayView<FBowContact> BowContacts() const { return BowWater; }
    const Sailing::FWakeHistory& ShedWake() const { return WakeTrail; }
    void DisturbSurface(FVector PositionCm, float HeightM);
    void WhaleContact(FVector PositionCm, float Strength, bool bDistant);
    void SetSeaScale(float Scale) { SeaScale.store(Scale, std::memory_order_relaxed); }
    void SetDeckLights(float Strength);
    void SetSurfaceWetness(float Wetness);
    const Sailing::FHelm& ReadHelm() const { return Helm; }
    Sailing::FSail ReadSail() const;
    void DriveHelm(float DeltaSeconds, int32 Steering, int32 Throttle, int32 Ease);
    void SetRudder(double Value);
    void SetThrottle(double Value) { Helm.Throttle = FMath::Clamp(Value, -1.0, 1.0); }
    void SetEngineRunning(bool bRunning);
    void ResumeAutoTrim() { Helm.bAutoTrim = true; }
    void CycleView();
    void SelectView(EYachtView Next);
    EYachtView CurrentView() const { return View; }
    void RecenterView();
    void OrbitView(FVector2D Pixels);
    void ZoomView(double WheelDelta);
    void SetCinematic(bool bEnabled);
    bool IsCinematic() const { return bCinematic; }
    const TCHAR* ViewName() const;
    USailingExplorer& Explorer() const { return *SkipperView; }
    TConstArrayView<TObjectPtr<ASailingJetSki>> JetSkis() const { return JetSkiFleet; }
    USailingEntryBubbles& EntryBubbles() const { return *Bubbles; }
    void ToggleExplorer();
    TOptional<FVector> FindTravelSpot(FVector2D PinM) const;
    bool TravelTo(FVector ApprovedSpot);
    uint32 TravelSequence() const { return TravelSerial; }
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
    UPROPERTY(Transient) TArray<TObjectPtr<ASailingJetSki>> JetSkiFleet;
    UPROPERTY() TObjectPtr<USailingEntryBubbles> Bubbles;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Rig;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Jib;
    UPROPERTY() TObjectPtr<USceneComponent> Boom;
    UPROPERTY() TObjectPtr<USpringArmComponent> ChaseArm;
    UPROPERTY() TObjectPtr<UCameraComponent> ChaseCamera;
    UPROPERTY() TObjectPtr<UCameraComponent> HelmCamera;
    UPROPERTY() TObjectPtr<UPointLightComponent> CockpitLamp;
    UPROPERTY() TObjectPtr<UPointLightComponent> PortLamp;
    UPROPERTY() TObjectPtr<UPointLightComponent> StarboardLamp;

    UPROPERTY() TObjectPtr<USailingMarineTraffic> MarineTraffic;
    UPROPERTY() TObjectPtr<USailingCrabs> ShoreCrabs;
    Sailing::FTrafficWater PhysicsTraffic;
    Sailing::FHelm Helm;
    FCriticalSection HelmMutex;
    Sailing::FHelm PhysicsHelm;
    TSharedPtr<const Sailing::FShoreMap, ESPMode::ThreadSafe> ShoreMap;
    Sailing::FShoreGuard PhysicsShoreGuard;
    std::atomic<bool> bRefloatRequested{false};
    void RefloatIfGrounded();
    Sailing::FWaterImpacts Impacts, PhysicsImpacts;
    Sailing::FWakeHistory WakeTrail, PhysicsWakeTrail;
    double LastBowClearance[2] = {};
    FBowContact BowWater[2];
    void UpdateBowContact();
    std::atomic<Sailing::FSeaFrame> WaterFrame{Sailing::FSeaFrame{}};
    std::atomic<float> SeaScale{1.0f};
    double BoomAngle = 0.0;
    double SailSpan = 1.0;
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
    bool bCoralPass = false;
    TWeakObjectPtr<ASailingSea> SurfaceForSampling;
    bool bKeyboardRudder = false;
    uint32 TravelSerial = 0;
    std::atomic<bool> bResetPhysicsTravel{false};
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

    UMaterialInstanceDynamic* SurfaceMaterial() const;
    void SetPrecipitation(float Intensity, float Wetness);
private:
    void BuildSurface();
    void BindSurfProfile();
    void SetSurfaceFrame(Sailing::FSeaFrame Frame);
    void UpdateChannelBuoys(const ASailingYachtPawn& Yacht, float DeltaSeconds);

    struct FChannelBuoy
    {
        TWeakObjectPtr<AStaticMeshActor> Actor;
        FTransform Mooring;
    };
    TArray<FChannelBuoy> ChannelBuoys;

    UPROPERTY(EditAnywhere, Category = "Sea") TObjectPtr<UMaterialInterface> WaterMaterial;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> Water;
    UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> Shore;
    UPROPERTY(Transient) TArray<TObjectPtr<UMaterialInstanceDynamic>> TidalStone;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> SurfProfile;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> RockFlow;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> RockWash;
    uint32 SentWakeRevision = MAX_uint32;
    Sailing::FSeaFrame PreviousSurfaceFrame{};
    UPROPERTY() TArray<TObjectPtr<UProceduralMeshComponent>> SurfaceTiles;
};

UCLASS()
class ASailingTrialHUD : public AHUD
{
    GENERATED_BODY()

public:
    void BeginPlay() override;
    ASailingTrialHUD();
    void DrawHUD() override;
    double ThrottleAt(double ScreenY) const;
    float InputScale() const { return UIScale; }

private:
    bool DrawDeckPanel(const ASailingPlayerController& Player, const ASailingYachtPawn& Yacht, FVector2D Size);
    UPROPERTY() TObjectPtr<ASailingWeather> Weather;
    UPROPERTY() TObjectPtr<UTexture2D> HelmAtlas;
    UPROPERTY() TObjectPtr<UTexture2D> InventoryArt;
    UPROPERTY() TObjectPtr<UFont> HelmFont;
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
