#include "SailingCrabs.h"
#include "SailingTrial.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
constexpr double PatchCm=475.;
bool Habitat(int32 Kind,double Z)
{
    return Kind==0 ? Z>=-16 && Z<=315 : Z< -40 && Z>=-4150;
}
}
USailingCrabs::USailingCrabs()
{
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Red(TEXT("/Game/Coastal/Meshes/SM_CrabRed"));
    static ConstructorHelpers::FObjectFinder<UStaticMesh> Blue(TEXT("/Game/Coastal/Meshes/SM_CrabBlue"));
    Models[0]=Red.Object; Models[1]=Blue.Object;
}
void USailingCrabs::Populate()
{
    for (int32 I=0; I<2; ++I)
    {
        auto* Mesh=NewObject<UInstancedStaticMeshComponent>(GetOwner());
        Meshes[I]=Mesh;
        Mesh->SetMobility(EComponentMobility::Movable);
        Mesh->SetStaticMesh(Models[I]);
        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
        Mesh->SetGenerateOverlapEvents(false);
        Mesh->SetCanEverAffectNavigation(false);
        Mesh->SetAffectDistanceFieldLighting(false);
        Mesh->SetCullDistances(2350,3000);
        Mesh->NumCustomDataFloats=2;
        Mesh->SetVisibility(false);
        Mesh->RegisterComponent();
        for (int32 J=0; J<Side*Side; ++J)
            Mesh->AddInstance(FTransform(FQuat::Identity,FVector::ZeroVector,FVector::ZeroVector));
    }
}

bool USailingCrabs::Ground(FVector2D XY,FVector& Point,FVector& Normal) const
{
    FHitResult Hit;
    FCollisionQueryParams Q(SCENE_QUERY_STAT(CrabFooting),true,GetOwner());
    if (!GetWorld()->LineTraceSingleByObjectType(Hit,FVector(XY,420.),FVector(XY,-4300.),
        FCollisionObjectQueryParams(ECC_WorldStatic),Q)) return false;
    const auto* Mesh=Cast<UStaticMeshComponent>(Hit.Component.Get());
    if (!Mesh || !Mesh->GetStaticMesh() || Hit.ImpactNormal.Z<.75) return false;
    const FString Name=Mesh->GetStaticMesh()->GetName();
    const bool Natural=Name.EndsWith(TEXT("Cay")) || Name==TEXT("SM_CloudHead") || Name==TEXT("SM_Volcano") ||
        Name==TEXT("SM_Boulder") || Name==TEXT("SM_CoastRocks") || Name==TEXT("SM_ReefShelf") ||
        (Name==TEXT("Cube") && Hit.ImpactPoint.Z < -3500.);
    if (!Natural) return false;
    Point=Hit.ImpactPoint; Normal=Hit.ImpactNormal;
    return true;
}
void USailingCrabs::Place(FCrab& C,FIntPoint Cell)
{
    C={};
    C.Cell=Cell;
    if (CollectedCells.Contains(Cell)) return;
    FRandomStream R(HashCombineFast(GetTypeHash(Cell.X),GetTypeHash(Cell.Y))^0x7d93ce1b);
    const FVector2D XY((Cell.X+R.FRandRange(.15f,.85f))*PatchCm,(Cell.Y+R.FRandRange(.15f,.85f))*PatchCm);
    if (!Ground(XY,C.Home,C.Normal)) return;
    const bool Land=Habitat(0,C.Home.Z);
    if (!Land && !Habitat(1,C.Home.Z)) return;
    C.Species=Land ? 0 : 1;
    C.Position=C.Home;
    C.Heading=R.FRandRange(-UE_PI,UE_PI);
    C.Width=Land ? R.FRandRange(.16,.26) : R.FRandRange(.28,.53);
    C.Speed=Land ? R.FRandRange(12,23) : R.FRandRange(7,16);
    C.Phase=R.FRandRange(0,2*UE_PI);
    C.Gait=R.FRandRange(0,2*UE_PI);
    C.Decision=R.FRandRange(.5,3.5);
    C.bMoving=R.FRand()>.36;
}

void USailingCrabs::Advance(const ASailingYachtPawn& Yacht,float Dt)
{
    if (!Meshes[0]) return;
    const auto* Player=Cast<APlayerController>(Yacht.GetController());
    if (!Player || !Player->PlayerCameraManager) return;
    const FVector Eye=Player->PlayerCameraManager->GetCameraLocation();
    Elapsed+=Dt;
    ScanIn-=Dt;
    if (ScanIn>0 && FVector::DistSquared(Eye,PreviousEye)<600.*600.) return;
    PreviousEye=Eye;
    const float Step=FMath::Min(.14f,.055f-ScanIn);
    ScanIn=.055f;
    const int32 X=FMath::FloorToInt(Eye.X/PatchCm), Y=FMath::FloorToInt(Eye.Y/PatchCm);
    bool InView[2]{};
    for (int32 Dy=-Side/2; Dy<=Side/2; ++Dy)
    for (int32 Dx=-Side/2; Dx<=Side/2; ++Dx)
    {
        const FIntPoint Cell(X+Dx,Y+Dy);
        const int32 I=((Cell.X%Side+Side)%Side)+Side*((Cell.Y%Side+Side)%Side);
        auto& C=Animals[I];
        if (Cell!=C.Cell)
        {
            if (C.Species!=INDEX_NONE && C.bVisible)
                Meshes[C.Species]->UpdateInstanceTransform(I,FTransform(FQuat::Identity,C.Position,FVector::ZeroVector),false,false,true);
            Place(C,Cell);
        }
        if (C.Species==INDEX_NONE) continue;
        const double Height=Eye.Z-C.Position.Z;
        const bool Visible=Height> -120 && Height<(C.Species==0 ? 1450. : 1350.);
        InView[C.Species]|=Visible;
        if (!Visible && !C.bVisible) continue;
        C.bVisible=Visible;
        auto* Mesh=Meshes[C.Species].Get();
        const FVector2D ToEye(Eye-C.Position);
        if (Visible)
        {
            C.Decision-=Step;
            if (C.Decision<=0)
            {
                C.bMoving=!C.bMoving;
                C.Decision=1.4f+1.05f*(1+FMath::Sin(C.Phase+Elapsed*.63f));
                const FVector2D Home(C.Home-C.Position);
                if (Home.SizeSquared()>135.*135.) C.Heading=FMath::Atan2(Home.Y,Home.X);
                else C.Heading+=.64*FMath::Sin(C.Phase+Elapsed);
            }
            const bool Flee=ToEye.SizeSquared()<170.*170. && FMath::Abs(Height)<220.;
            if (Flee) C.Heading=FMath::Atan2(-ToEye.Y,-ToEye.X);
            if (C.bMoving || Flee)
            {
                const FVector2D Heading(FMath::Cos(C.Heading),FMath::Sin(C.Heading));
                const float Travel=C.Speed*Step*(Flee ? 2.7f : 1.f);
                FVector Next,Up;
                if (Ground(FVector2D(C.Position)+Heading*Travel,Next,Up) &&
                    Habitat(C.Species,Next.Z) && FMath::Abs(Next.Z-C.Position.Z)<10.)
                {
                    C.Position=Next; C.Normal=Up;
                    C.Gait+=Travel/(C.Width*12.f);
                }
                else { C.Heading+=UE_PI*.73f; C.bMoving=false; C.Decision=.6f; }
            }
            float Animation[] = {C.Gait, C.bMoving || Flee ? 1.f : 0.f};
            Mesh->SetCustomData(I, Animation, false);
        }
        const FVector BodyForward(FMath::Sin(C.Heading),-FMath::Cos(C.Heading),0);
        const auto Rotation=FRotationMatrix::MakeFromZX(C.Normal,BodyForward).ToQuat();
        Mesh->UpdateInstanceTransform(I,FTransform(Rotation,C.Position+C.Normal*.45,
            FVector(Visible ? C.Width : 0.f)),false,false,true);
    }
    for (int32 K=0; K<2; ++K) Meshes[K]->SetVisibility(InView[K]);
}

bool USailingCrabs::Nearest(bool Underwater,FVector From,FVector& Found) const
{
    double Distance=UE_DOUBLE_BIG_NUMBER;
    for (const auto& C : Animals)
    {
        if (C.Species!=(Underwater ? 1 : 0)) continue;
        const double D=FVector::DistSquared(From,C.Position);
        if (D<Distance) {Distance=D; Found=C.Position;}
    }
    return Distance<UE_DOUBLE_BIG_NUMBER;
}

int32 USailingCrabs::CollectibleIndex(ESailingCrab Kind, FVector From) const
{
    const double ReachCm = Kind == ESailingCrab::Shore ? 155. : 185.;
    double BestDistance = FMath::Square(ReachCm);
    int32 Best = INDEX_NONE;
    for (int32 Index = 0; Index < UE_ARRAY_COUNT(Animals); ++Index)
    {
        const FCrab& Crab = Animals[Index];
        if (!Crab.bVisible || Crab.Species != int32(Kind)) continue;
        const double Distance = FVector::DistSquared(From, Crab.Position);
        if (Distance >= BestDistance) continue;
        BestDistance = Distance;
        Best = Index;
    }
    return Best;
}

bool USailingCrabs::CanCollect(ESailingCrab Kind, FVector From) const
{
    return CollectibleIndex(Kind, From) != INDEX_NONE;
}

bool USailingCrabs::Collect(ESailingCrab Kind, FVector From)
{
    const int32 Index = CollectibleIndex(Kind, From);
    if (Index == INDEX_NONE) return false;
    FCrab& Crab = Animals[Index];
    CollectedCells.Add(Crab.Cell);
    Meshes[Crab.Species]->UpdateInstanceTransform(Index,
        FTransform(FQuat::Identity, Crab.Position, FVector::ZeroVector), false, false, true);
    Crab.Species = INDEX_NONE;
    Crab.bVisible = false;
    return true;
}
