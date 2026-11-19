#pragma once

#include "Kismet/BlueprintFunctionLibrary.h"
#include "CoralMaterialAuthoring.generated.h"

class UMaterial;

UCLASS()
class UCoralMaterialAuthoring : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
#if WITH_EDITOR
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static void ResetGraph(UMaterial* Material);
#endif
};
