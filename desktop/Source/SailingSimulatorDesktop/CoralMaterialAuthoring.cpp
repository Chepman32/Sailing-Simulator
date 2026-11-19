#include "CoralMaterialAuthoring.h"

#if WITH_EDITOR
#include "Materials/Material.h"
#include "Materials/MaterialExpression.h"

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
#endif
