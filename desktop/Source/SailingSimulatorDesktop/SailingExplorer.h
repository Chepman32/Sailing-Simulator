#pragma once

#include "CoreMinimal.h"
#include "Camera/CameraComponent.h"
#include "SailingExplorer.generated.h"

class ASailingYachtPawn;
class USpotLightComponent;

enum class ESkipperMode : uint8 { Helm, Leap, Swim, Deck, Shore };

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
    void Crouch();
    void ToggleTorch();
    void Interact(ASailingYachtPawn& Yacht);
    const TCHAR* Prompt(const ASailingYachtPawn& Yacht) const;
    ESkipperMode Mode() const { return State; }
    bool Away() const { return State != ESkipperMode::Helm; }
    bool TorchOn() const;
    void SetFrozen(bool bValue) { bFrozen = bValue; ClearInput(); }
    float DepthM() const { return Depth; }
    float AirFraction() const { return Air; }

private:
    void PrepareFooting();
    double GroundAt(const FVector& Point, double Top) const;
    void StepLeap(const ASailingYachtPawn& Yacht, float Dt);
    void StepSwim(const ASailingYachtPawn& Yacht, float Dt);
    void StepWalk(const ASailingYachtPawn& Yacht, float Dt);
    void EnterWater(const ASailingYachtPawn& Yacht, FVector Eye, float EntrySpeed, float Impact);
    void Splash(const ASailingYachtPawn& Yacht, FVector Eye);
    FVector MoveDirection() const;
    bool AtLadder(const ASailingYachtPawn& Yacht) const;

    UPROPERTY() TObjectPtr<USpotLightComponent> Torch;
    ESkipperMode State = ESkipperMode::Helm;
    FVector2D Movement = FVector2D::ZeroVector;
    FVector Velocity = FVector::ZeroVector;
    FVector Feet = FVector::ZeroVector; // In yacht space on deck, world space ashore.
    float Yaw = 0, Pitch = 0, LeapTime = 0, Depth = 0, Air = 1;
    bool bSprint = false, bUp = false, bDown = false, bGrounded = false;
    bool bCrouched = false, bFloating = true, bPrepared = false;
    bool bFrozen = false;
    float PendingImpact = 0, EntryGlide = 0;
};
