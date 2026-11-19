#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingSignal.generated.h"

class UCameraComponent;
class UPointLightComponent;
class UStaticMeshComponent;
class UMaterialInterface;

UCLASS()
class ASailingSignal : public AActor
{
    GENERATED_BODY()
public:
    ASailingSignal();
    void Light(bool bGreen, FVector Forward);
    void Tick(float Dt) override;
    float Age() const { return Elapsed; }
    bool IsGreen() const { return bGreenSignal; }
private:
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Ember;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Streak;
    UPROPERTY() TObjectPtr<UStaticMeshComponent> Canopy;
    UPROPERTY() TObjectPtr<UPointLightComponent> Glow;
    UPROPERTY() TObjectPtr<UCameraComponent> Camera;
    UPROPERTY() TObjectPtr<UMaterialInterface> Emission;
    FVector Heading=FVector::ForwardVector;
    float Elapsed=0;
    bool bGreenSignal=false;
};
