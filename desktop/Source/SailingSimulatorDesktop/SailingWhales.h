#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingWhales.generated.h"

class ASailingYachtPawn;
class ASailingWeather;
class USailingEntryBubbles;

UCLASS()
class ASailingWhales : public AActor
{
    GENERATED_BODY()
public:
    ASailingWhales();
    void BeginPlay() override;
    void Tick(float Dt) override;

private:
    struct FPass
    {
        FVector Start, Direction;
        double Age = -1, Next = 0;
        double LastFlukeClearance = -1000.;
        bool bBlew = false, bDived = false, bShowedBack = false;
    };
    struct FBreach
    {
        FVector Launch, Course, ImpactCentre;
        FRotator ImpactRotation;
        double Next = 0., Age = -1., LandedAt = -1.;
        double ForwardSpeed = 0., RiseSpeed = 0., Roll = 0., DescentSpeed = 0.;
        bool bLaunched = false;
    };
    bool FindLane(const ASailingYachtPawn& Yacht, bool bBreach, FVector& Site, FVector& Course) const;
    void Swim(ASailingYachtPawn& Yacht, float Dt);
    void Jump(ASailingYachtPawn& Yacht, float Dt);
    void Land(ASailingYachtPawn& Yacht, FVector Contact, FVector Centre, FRotator Rotation, double DescentSpeed);
    UPROPERTY(EditAnywhere, Category="Wildlife") TObjectPtr<UStaticMesh> WhaleMesh;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Visitor;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Breacher;
    UPROPERTY() TObjectPtr<USailingEntryBubbles> NearBubbles;
    UPROPERTY() TObjectPtr<USailingEntryBubbles> FarBubbles;
    UPROPERTY(Transient) TObjectPtr<ASailingWeather> Weather;
    FPass Near;
    FBreach Far;
    FRandomStream BreachRandom{7349};
};
