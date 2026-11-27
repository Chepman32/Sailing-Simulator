#pragma once

#include "CoreMinimal.h"
#include "Camera/CameraComponent.h"
#include "SailingExplorer.generated.h"

class ASailingYachtPawn;
class ASailingJetSki;
class USpotLightComponent;

enum class ESkipperMode : uint8 { Helm, Leap, Swim, Deck, Shore, JetSki };
enum class ESailingCrab : uint8;

UCLASS()
class USailingExplorer : public UCameraComponent
{
    GENERATED_BODY()

public:
    USailingExplorer();
    void Leave(ASailingYachtPawn& Yacht);
    void Return();
    void Advance(ASailingYachtPawn& Yacht, float Dt);
    void SetMovement(FVector2D Axes, bool bFast, bool bRise, bool bSink);
    void ClearInput();
    void Look(float YawDelta, float PitchDelta);
    void Jump();
    void CrouchOrDive(const ASailingYachtPawn& Yacht);
    void ToggleTorch();
    TOptional<ESailingCrab> Interact(ASailingYachtPawn& Yacht);
    const TCHAR* Prompt(const ASailingYachtPawn& Yacht) const;
    ASailingJetSki* MountedJetSki() const;
    void RecenterJetSkiView();
    void Arrive(const ASailingYachtPawn& Yacht, FVector Point, bool bWalking);
    ESkipperMode Mode() const { return State; }
    bool Away() const { return State != ESkipperMode::Helm; }
    bool TorchOn() const;
    void SetFrozen(bool bValue) { bFrozen = bValue; ClearInput(); }
    float DepthM() const { return Depth; }
    FVector ShoreFooting() const { return Feet; }
    float AirFraction() const { return Air; }
    float AirSecondsAtDepth() const;
    enum class EFootSurface : uint8 { Deck, Wood, Sand, WetSand, Grass, Rock, Water };
    struct FFootfall
    {
        uint32 Sequence = 0;
        EFootSurface Surface = EFootSurface::Deck;
        FVector ContactCm = FVector::ZeroVector;
        FVector VelocityCmS = FVector::ZeroVector;
        float WaterDepthM = 0.f;
        float Strength = 1.f;
        bool bRunning = false;
    };
    const FFootfall& LastFootfall() const { return Footfall; }
    struct FWaterEntry
    {
        uint32 Sequence = 0;
        FVector ContactCm = FVector::ZeroVector;
        FVector VelocityCmS = FVector::ZeroVector;
        float ImpactCmS = 0;
    };
    const FWaterEntry& LastWaterEntry() const { return WaterEntry; }

private:
    friend class USailingViewportClient;

    void PrepareFooting();
    double GroundAt(const FVector& Point, double Top, FHitResult* Contact = nullptr) const;
    void StepLeap(const ASailingYachtPawn& Yacht, float Dt);
    void StepSwim(const ASailingYachtPawn& Yacht, float Dt);
    void StepWalk(const ASailingYachtPawn& Yacht, float Dt);
    void StandAt(FVector Footing, FVector WalkingVelocity);
    void EnterWater(const ASailingYachtPawn& Yacht, FVector Eye, FVector EntryVelocity, float Impact);
    void RecordWaterContact(const ASailingYachtPawn& Yacht, FVector Point, FVector ImpactVelocity, float Impact);
    void Splash(const ASailingYachtPawn& Yacht, FVector Eye);
    FVector MoveDirection() const;
    bool AtLadder(const ASailingYachtPawn& Yacht) const;
    bool AtHelm() const;
    TOptional<ESailingCrab> CrabHabitat() const;
    FVector CrabReachOrigin() const;
    ASailingJetSki* NearbyJetSki(const ASailingYachtPawn& Yacht) const;
    void MountJetSki(ASailingJetSki& Ski);
    void DismountJetSki(const ASailingYachtPawn& Yacht, ASailingJetSki& Ski);
    void UpdateJetSkiView(const ASailingJetSki& Ski, float Dt = 0);
    double RideHeight = 0, RidePitch = 0, RideRoll = 0;

    UPROPERTY() TObjectPtr<USpotLightComponent> Torch;
    TWeakObjectPtr<ASailingJetSki> Ride;
    ESkipperMode State = ESkipperMode::Helm;
    FVector2D Movement = FVector2D::ZeroVector;
    FVector Velocity = FVector::ZeroVector;
    FVector Feet = FVector::ZeroVector; // In yacht space on deck, world space ashore.
    FVector FloorNormal = FVector::UpVector;
    float Yaw = 0, Pitch = 0, LeapTime = 0, Depth = 0, Air = 1;
    bool bSprint = false, bUp = false, bDown = false, bGrounded = false;
    bool bDivePressedLast = false;
    bool bLeapContactReported = false;
    bool bCrouched = false, bFloating = true, bSurfaceSwim = false, bPrepared = false;
    bool bFrozen = false;
    double StepTravelCm = 0.;
    double EyeHeightCm = 0., StepOffsetCm = 0., LandingOffsetCm = 0., WalkSway = 0.;
    FFootfall Footfall;
    FWaterEntry WaterEntry;
    float BreathTime = 0;
    float PendingImpact = 0, EntryGlide = 0, DuckDiveTime = 0;
};
