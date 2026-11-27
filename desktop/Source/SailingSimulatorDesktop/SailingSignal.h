#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSignal.generated.h"

class UCameraComponent;
class UPointLightComponent;
class UStaticMeshComponent;
class UMaterialInterface;
class ASailingYachtPawn;

UCLASS()
class ASailingSignal : public AActor
{
    GENERATED_BODY()
public:
    ASailingSignal();
    void Light(bool bGreen, ASailingYachtPawn& Yacht);
    void Tick(float Dt) override;
    float Age() const { return FMath::Max(0.f, Elapsed - LaunchLeadSeconds); }
    bool IsGreen() const { return bGreenSignal; }
private:
    static constexpr float LaunchLeadSeconds = .24f;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Ember;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Streak;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Canopy;
    UPROPERTY() TObjectPtr<UPointLightComponent> Glow;
    UPROPERTY() TObjectPtr<UCameraComponent> Camera;
    UPROPERTY() TObjectPtr<UMaterialInterface> Emission;
    TWeakObjectPtr<ASailingYachtPawn> LaunchYacht;
    FVector Heading=FVector::ForwardVector;
    float Elapsed=0;
    bool bGreenSignal=false;
};
