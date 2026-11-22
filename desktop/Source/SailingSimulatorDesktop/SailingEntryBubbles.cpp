#include "SailingEntryBubbles.h"

#include "Engine/StaticMesh.h"
#include "Camera/PlayerCameraManager.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "SailingTrial.h"
#include "UObject/ConstructorHelpers.h"

USailingEntryBubbles::USailingEntryBubbles()
{
    PrimaryComponentTick.bCanEverTick = true;
    PrimaryComponentTick.bStartWithTickEnabled = false;
    PrimaryComponentTick.TickGroup = TG_PostPhysics;
    SetAbsolute(true,true,true);
    SetCollisionEnabled(ECollisionEnabled::NoCollision);
    SetGenerateOverlapEvents(false);
    SetCastShadow(false);
    SetCanEverAffectNavigation(false);
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Plane(TEXT("/Engine/BasicShapes/Plane.Plane"));
    static ConstructorHelpers::FObjectFinderOptional<UMaterialInterface> Skin(
        TEXT("/Game/Coastal/Materials/M_EntryBubble.M_EntryBubble"), LOAD_Quiet | LOAD_NoWarn);
    SetStaticMesh(Plane.Object);
    if (Skin.Get()) SetMaterial(0,Skin.Get());
}

void USailingEntryBubbles::Splash(const ASailingYachtPawn& Yacht, FVector Eye, FVector Forward, float ImpactCmS)
{
    const float Strength = FMath::Clamp(ImpactCmS/650.f, .22f, 1.f);
    const int32 Count = FMath::RoundToInt(26 + 48*Strength);
    if (Bubbles.Num()+Count > Capacity)
        Bubbles.RemoveAt(0,Bubbles.Num()+Count-Capacity,EAllowShrinking::No);
    const FVector Ahead = Forward.GetSafeNormal2D();
    const FVector Side = FVector::CrossProduct(FVector::UpVector,Ahead);
    const double Surface = 100*Yacht.SurfaceHeightM(FVector2D(Eye)*.01);
    for (int32 I=0; I<Count; ++I)
    {
        const float T = Random.FRand(), Angle = Random.FRandRange(0, UE_TWO_PI);
        const FVector Out = Ahead*FMath::Cos(Angle) + Side*FMath::Sin(Angle);
        // Air drawn down by the impact and broken up around the shoulders.
        const float Radius = I%9==0 ? Random.FRandRange(1.7,2.65) :
                             I%3==0 ? Random.FRandRange(.60,1.45) : Random.FRandRange(.16,.60);
        FVector P = Eye + Ahead*(32. + 72.*T) + Out*Random.FRandRange(12.f,49.f);
        P.Z = Surface - (13 + T*(43 + 88*Strength)) + Random.FRandRange(-10,10);
        const FVector V = Out*Random.FRandRange(7.f,38.f) + Ahead*Random.FRandRange(5.f,28.f)
                        - FVector::UpVector*(Random.FRandRange(40.f,142.f)*Strength);
        Bubbles.Add({P,V,Radius,0,Random.FRandRange(2.8f,4.7f),Angle});
    }
    DrawBubbles();
    SetComponentTickEnabled(true);
}

void USailingEntryBubbles::TickComponent(float Dt, ELevelTick TickType, FActorComponentTickFunction* Tick)
{
    Super::TickComponent(Dt,TickType,Tick);
    const auto* Yacht = CastChecked<ASailingYachtPawn>(GetOwner());
    // Across this metre-wide plume the moving water is locally planar. Three
    // shared height samples include waves and wake even when the yacht moves on.
    if (Bubbles.IsEmpty()) return;
    const FVector2D Origin(Bubbles[0].Position);
    auto Height = [&](FVector2D Cm){ return 100.*Yacht->SurfaceHeightM(Cm*.01); };
    const double Water = Height(Origin);
    const FVector2D Slope((Height(Origin+FVector2D(55,0))-Water)/55.,
                          (Height(Origin+FVector2D(0,55))-Water)/55.);
    for (int32 I=Bubbles.Num()-1; I>=0; --I)
    {
        auto& B = Bubbles[I];
        B.Age += Dt;
        const double W = B.Phase + B.Age*(5.8 - .57*B.Radius);
        const double Wandering = 1.7 + B.Radius*1.9;
        const FVector Drift(3.5 + Wandering*FMath::Cos(W), 1.8 + Wandering*FMath::Sin(W*1.19),
                            6. + 23.*FMath::Sqrt(B.Radius));
        B.Velocity = FMath::Lerp(B.Velocity, Drift, 1.-FMath::Exp(-3.5*Dt));
        B.Position += B.Velocity*Dt;
        const double LocalWater = Water + FVector2D::DotProduct(Slope,FVector2D(B.Position)-Origin);
        if (B.Position.Z+B.Radius >= LocalWater || B.Age >= B.Life)
            Bubbles.RemoveAtSwap(I,1,EAllowShrinking::No);
    }
    DrawBubbles();
    if (Bubbles.IsEmpty()) SetComponentTickEnabled(false);
}

void USailingEntryBubbles::DrawBubbles()
{
    Transforms.Reset(Bubbles.Num());
    const auto* Camera=UGameplayStatics::GetPlayerCameraManager(this,0);
    const FRotator View=Camera ? Camera->GetCameraRotation() : FRotator::ZeroRotator;
    const FQuat Facing=FRotationMatrix::MakeFromZX(-View.Vector(),View.RotateVector(FVector::RightVector)).ToQuat();
    for (const FBubble& B : Bubbles)
    {
        const float Flatten = .04f + .15f*FMath::Min(B.Radius/3.f,1.f);
        const float Wobble = Flatten*.35f*FMath::Sin(B.Phase+7.3f*B.Age);
        const float Radius = B.Radius * FMath::Clamp((B.Life-B.Age)*3.f, .01f, 1.f);
        const FVector Shape(1+Flatten*.5+Wobble,1-Flatten-Wobble,1.);
        Transforms.Emplace(Facing,B.Position,Shape*(Radius/50.));
    }
    while (GetInstanceCount()>Transforms.Num()) RemoveInstance(GetInstanceCount()-1);
    const int32 Existing = GetInstanceCount();
    if (Existing < Transforms.Num())
        for (int32 I=Existing; I<Transforms.Num(); ++I) AddInstance(Transforms[I],true);
    if (!Transforms.IsEmpty()) BatchUpdateInstancesTransforms(0,Transforms,true,true,true);
}
