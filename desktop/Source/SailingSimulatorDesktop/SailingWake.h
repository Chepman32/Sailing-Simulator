#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SailingFoamField.h"
#include "SailingWake.generated.h"

class ASailingSea;
class UMaterialInstanceDynamic;
class UTexture2D;

UCLASS()
class ASailingWake : public AActor
{
    GENERATED_BODY()
public:
    ASailingWake();
    void BeginPlay() override;
    void Tick(float DeltaSeconds) override;
private:
    Sailing::FFoamField Field;
    UPROPERTY() TObjectPtr<ASailingSea> Sea;
    UPROPERTY(Transient) TObjectPtr<UTexture2D> Maps[2];
    TWeakObjectPtr<UMaterialInstanceDynamic> BoundWater;
    int32 Latest = 0;
    float Published = -1;
    float LastBreak[2]{-10.f,-10.f};
};
