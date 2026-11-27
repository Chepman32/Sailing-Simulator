#pragma once

#include "Components/ActorComponent.h"
#include "SailingPhysics.h"
#include "SailingMarineTraffic.generated.h"

class ASailingYachtPawn;
class AStaticMeshActor;
class UMaterialInstanceDynamic;
class UTexture2D;

UCLASS()
class USailingMarineTraffic : public UActorComponent
{
    GENERATED_BODY()
public:
    USailingMarineTraffic();
    void Launch(ASailingYachtPawn& Yacht);
    void Advance(const ASailingYachtPawn& Yacht, float Time);
    void Publish(UMaterialInstanceDynamic& Water, float Time);
    void EndPlay(const EEndPlayReason::Type Reason) override;
    const Sailing::FTrafficWater& Field() const { return Wakes; }
    AStaticMeshActor* FirstShip() const;
private:
    UPROPERTY() TObjectPtr<UStaticMesh> Hulls[2];
    UPROPERTY(Transient) TArray<TObjectPtr<AStaticMeshActor>> Ships;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> TrackMap;
    TWeakObjectPtr<UMaterialInstanceDynamic> BoundWater;
    Sailing::FTrafficWater Wakes;
    float LastUpload=-10.f;
};
