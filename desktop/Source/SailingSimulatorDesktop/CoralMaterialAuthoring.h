#pragma once

#include "Kismet/BlueprintFunctionLibrary.h"
#include "CoralMaterialAuthoring.generated.h"

class UMaterial;
class UMaterialExpression;
class UVolumeTexture;

UCLASS()
class UCoralMaterialAuthoring : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
#if WITH_EDITOR
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static TArray<FVector2D> GetSeaWaveVectors();
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static void ResetGraph(UMaterial* Material);
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static void SetCoatFinish(UMaterial* Material, UMaterialExpression* Finish);
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static void SetDisplacementHeight(UMaterial* Material, UMaterialExpression* Height);
    UFUNCTION(BlueprintCallable, Category = "Sailing|Editor")
    static bool ImportWaveVolume(UVolumeTexture* Texture, const FString& Filename, int32 Size, int32 Frames);
#endif
};
