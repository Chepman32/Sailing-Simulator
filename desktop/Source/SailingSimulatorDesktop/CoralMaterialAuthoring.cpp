#include "CoralMaterialAuthoring.h"

#if WITH_EDITOR
#include "Engine/VolumeTexture.h"
#include "Misc/FileHelper.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"
#include "SailingPhysics.h"

TArray<FVector2D> UCoralMaterialAuthoring::GetSeaWaveVectors()
{
    TArray<FVector2D> Vectors;
    for (int32 I=0; I<Sailing::SeaWaveCount; ++I)
    {
        const FLinearColor Mode=Sailing::SeaWaveParameter(I,{});
        Vectors.Emplace(Mode.R,Mode.G);
    }
    return Vectors;
}

bool UCoralMaterialAuthoring::ImportWaveVolume(UVolumeTexture* Texture, const FString& Filename, int32 Size, int32 Frames)
{
    TArray64<uint8> Bytes;
    if (!Texture || Size<=0 || Size>512 || Frames<=0 || Frames>256 ||
        !FFileHelper::LoadFileToArray(Bytes,*Filename) || Bytes.Num()!=int64(Size)*Size*Frames*4) return false;
    Texture->Modify();
    Texture->Source.Init(Size,Size,Frames,1,TSF_BGRA8,Bytes.GetData());
    Texture->SRGB=false;
    Texture->CompressionSettings=TC_VectorDisplacementmap;
    Texture->MipGenSettings=TMGS_SimpleAverage;
    // The material samples world coordinates in a custom expression on a procedural ocean.
    // Its mesh UVs encode cell size, so they cannot tell the streamer which mips are visible.
    Texture->NeverStream=true;
    Texture->Filter=TF_Trilinear;
    Texture->AddressMode=TA_Wrap;
    Texture->PostEditChange();
    Texture->MarkPackageDirty();
    return true;
}

void UCoralMaterialAuthoring::ResetGraph(UMaterial* Material)
{
    if (!Material) return;
    Material->Modify();
    // Startup assets can root their expression objects. Detach the authored graph
    // without marking rooted UObjects as garbage or replacing the material package.
    for (UMaterialExpression* Expression : Material->GetExpressions())
    {
        Material->RemoveExpressionParameter(Expression);
    }
    for (int32 Index = 0; Index < MP_MAX; ++Index)
    {
        if (FExpressionInput* Input = Material->GetExpressionInputForProperty(static_cast<EMaterialProperty>(Index)))
        {
            Input->Expression = nullptr;
        }
    }
    Material->GetExpressionCollection().Empty();
    Material->MarkPackageDirty();
}

void UCoralMaterialAuthoring::SetCoatFinish(UMaterial* Material, UMaterialExpression* Finish)
{
    if (!Material || !Finish) return;
    // Clear coat and coat roughness are hidden properties in the Python editor API.
    const EMaterialProperty Pins[] = {MP_Roughness,MP_CustomData0,MP_CustomData1};
    for (int32 Channel=0; Channel<3; ++Channel)
    {
        FExpressionInput* Pin = Material->GetExpressionInputForProperty(Pins[Channel]);
        Pin->Connect(0,Finish);
        Pin->SetMask(1,Channel==0,Channel==1,Channel==2,0);
    }
}

void UCoralMaterialAuthoring::SetDisplacementHeight(UMaterial* Material, UMaterialExpression* Height)
{
    if (!Material || !Height) return;
    // The displacement input is hidden from the Python material editor API.
    FExpressionInput* Pin = Material->GetExpressionInputForProperty(MP_Displacement);
    Pin->Connect(0, Height);
    Pin->SetMask(1, 1, 0, 0, 0);
}
#endif
