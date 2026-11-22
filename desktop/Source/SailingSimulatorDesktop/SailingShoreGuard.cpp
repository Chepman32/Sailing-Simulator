#include "SailingShoreGuard.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "EngineUtils.h"
#include "Materials/Material.h"

namespace Sailing
{
namespace
{
constexpr double KeelContourM = -2.0; // 0.8 m draft plus room for heel and wave troughs.
constexpr double LookAheadM = 24.0;
constexpr int32 Directions = 192;
FVector2D Perpendicular(FVector2D V) { return {-V.Y,V.X}; }
}

FShoreMap::FShoreMap(UWorld& World)
{
    for (TActorIterator<AStaticMeshActor> It(&World); It; ++It)
    {
        UStaticMeshComponent* Mesh = It->GetStaticMeshComponent();
        const UMaterialInterface* Surface = Mesh ? Mesh->GetMaterial(0) : nullptr;
        const UMaterial* Base = Surface ? Surface->GetMaterial() : nullptr;
        if (!Base || Mesh->GetCollisionResponseToChannel(ECC_PhysicsBody)!=ECR_Block) continue;
        const FName Material = Base->GetFName();
        if (Material!=TEXT("M_CoastalGround") && Material!=TEXT("M_VolcanicRock") && Material!=TEXT("M_TrialSand")) continue;
        const FBox Bounds = Mesh->Bounds.GetBox();
        const double Z = KeelContourM*100;
        if (Bounds.Min.Z>=Z || Bounds.Max.Z<0) continue;

        // Both maps author each island around its own origin. A horizontal ray
        // from the sea hits the actual submerged shelf, including its coves.
        const FVector2D Center(Mesh->GetComponentLocation());
        const double Reach = 100 + FVector2D::Distance(Center,FVector2D(Bounds.GetCenter())) + FVector2D(Bounds.GetExtent()).Size();
        TArray<FVector2D> Rim;
        Rim.Reserve(Directions);
        for (int32 I=0; I<Directions; ++I)
        {
            const double Angle = I*(UE_DOUBLE_TWO_PI/Directions);
            const FVector2D Ray(FMath::Cos(Angle),FMath::Sin(Angle));
            FHitResult Hit;
            if (Mesh->LineTraceComponent(Hit,FVector(Center+Ray*Reach,Z),FVector(Center,Z),FCollisionQueryParams(NAME_None,true)))
                Rim.Add(FVector2D(Hit.ImpactPoint)*.01);
        }
        if (Rim.Num()<3) continue;
        FIsland& Island = Islands.Emplace_GetRef();
        Island.Edges.Reserve(Rim.Num());
        FVector2D A = Rim.Last();
        for (const FVector2D B : Rim)
        {
            const FVector2D Segment = B-A;
            if (!Segment.IsNearlyZero()) Island.Edges.Add({A,Segment,1./Segment.SizeSquared()});
            Island.Vicinity += B;
            A=B;
        }
        Island.Vicinity=Island.Vicinity.ExpandBy(LookAheadM+7.0);
    }
}

FShoreContact FShoreMap::AtHull(FVector2D CenterM, FVector2D Bow) const
{
    FShoreContact Contact;
    const FVector2D Beam = Perpendicular(Bow);
    // Fore and aft steps, the widest part of each hull, and the bridge between them.
    constexpr double Stations[][2]={{5.65,2.1},{5.65,-2.1},{0,2.78},{0,-2.78},{-5.5,2.4},{-5.5,-2.4},{0,0}};
    for (const FIsland& Island : Islands)
    {
        if (!Island.Vicinity.IsInside(CenterM)) continue;
        for (const auto& Station : Stations)
        {
            const FVector2D Offset=Bow*Station[0]+Beam*Station[1];
            const FVector2D P=CenterM+Offset;
            FVector2D Separation=FVector2D::ZeroVector, EdgeNormal=FVector2D::ZeroVector;
            double NearestSquared=TNumericLimits<double>::Max();
            bool Inside=false;
            for (const FEdge& Edge : Island.Edges)
            {
                const FVector2D V=P-Edge.Start;
                // Crossings of the rightward ray give the sign even at a concave corner.
                if ((V.Y<0)!=(V.Y<Edge.Delta.Y) && V.X<Edge.Delta.X*(V.Y/Edge.Delta.Y)) Inside=!Inside;
                const double T=FMath::Clamp(FVector2D::DotProduct(V,Edge.Delta)*Edge.InverseLengthSquared,0.,1.);
                const FVector2D FromEdge=V-T*Edge.Delta;
                const double DistSquared=FromEdge.SizeSquared();
                if (DistSquared<NearestSquared)
                {
                    NearestSquared=DistSquared;
                    Separation=FromEdge;
                    EdgeNormal=-Perpendicular(Edge.Delta);
                }
            }
            const double Distance=(Inside ? -1. : 1.)*FMath::Sqrt(NearestSquared);
            if (Distance<Contact.ClearanceM)
            {
                Contact={Distance,FMath::Abs(Distance)>1e-6 ? Separation/Distance : EdgeNormal.GetSafeNormal(),Offset};
            }
        }
    }
    return Contact;
}

bool FShoreGuard::Constrain(const FShoreMap& Map, const FRigidState& Boat, const FHelm& Helm, double Dt, FLoads& Loads)
{
    const FVector2D Bow(Boat.Rotation.GetForwardVector().GetSafeNormal2D());
    const FShoreContact Contact=Map.AtHull(FVector2D(Boat.OriginM),Bow);
    const double D=Contact.ClearanceM;
    if (D>LookAheadM)
    {
        PassingSide=0;
        GroundedSeconds=0;
        StalledSeconds=0;
        return false;
    }
    const FVector2D Out=Contact.Seaward, Along=Perpendicular(Out);
    const FVector2D Velocity(Boat.VelocityMps);
    const double YawRate=Boat.AngularVelocityRad.Z;
    const FVector2D SpinLever=Perpendicular(Contact.HullOffsetM);
    const double OutSpeed=FVector2D::DotProduct(Velocity+SpinLever*YawRate,Out);
    const double Closing=FMath::Max(0.,-OutSpeed);
    const double Ahead=FVector2D::DotProduct(Velocity,Bow);
    // As the boat slows against the cushion a wave can briefly reverse surge.
    // Keep the commanded end leading through the low-speed part of the turn.
    const double DriveSign=Helm.bEngineOn && FMath::Abs(Helm.Throttle)>.05 && FMath::Abs(Ahead)<1.25 ?
        FMath::Sign(Helm.Throttle) : (FMath::Abs(Ahead)>.12 ? FMath::Sign(Ahead) : 1.);
    const FVector2D Travel=Bow*DriveSign;
    const double HeadingOut=FVector2D::DotProduct(Travel,Out);
    const double BrakingRoom=FMath::Min(LookAheadM,3.+Closing*1.2+Closing*Closing/4.);
    const bool SteeringOut=Helm.Rudder*DriveSign*FVector2D::CrossProduct(Travel,Out)>.12;
    if (Helm.bHoveTo || SteeringOut || D>BrakingRoom+(PassingSide ? 6. : 0.) || HeadingOut>.28) PassingSide=0;
    else if (!PassingSide && HeadingOut<-.12 && (FMath::Abs(Ahead)>.35 || (Helm.bEngineOn && FMath::Abs(Helm.Throttle)>.05)))
    {
        const double AlongSpeed=FVector2D::DotProduct(Travel,Along);
        PassingSide=FMath::Abs(AlongSpeed)>.15 ? FMath::Sign(AlongSpeed) : (Helm.Rudder*DriveSign<0 ? 1 : -1);
    }
    if (PassingSide)
    {
        const FVector2D Course=(Along*PassingSide+Out*.48).GetSafeNormal();
        const double Error=FMath::Atan2(FVector2D::CrossProduct(Travel,Course),FVector2D::DotProduct(Travel,Course));
        const double TargetRate=FMath::Clamp(Error*1.2,-.48,.48);
        // Apply a yaw moment about the mast. The helm and sheet settings stay with the skipper.
        constexpr double YawInertia=MassKg*(9.5*9.5+4.48*4.48)/12.;
        Loads.TorqueNm.Z+=YawInertia*FMath::Clamp((TargetRate-YawRate)*2.6,-.85,.85);
    }

    // Limit only the component driving the nearest hull into the shoal.
    // Alongshore motion and an outward helm remain available, including in reverse.
    constexpr double Margin=.8;
    const double MinOut=D>Margin ? -FMath::Sqrt(4.*(D-Margin)) : FMath::Min(2.2,1.8*(Margin-D));
    const double NextOut=OutSpeed+Dt*FVector2D::DotProduct(FVector2D(Loads.ForceN),Out)/MassKg;
    const double Push=FMath::Clamp((MinOut-NextOut)/Dt,0.,5.5);
    Loads.ForceN+=FVector(Out,0)*(MassKg*Push);

    // Under sustained power the rig can cancel astern thrust just outside the
    // keel contour. A velocity limit alone leaves her hanging in the surf there.
    const bool Driving = Helm.bEngineOn && FMath::Abs(Helm.Throttle)>.22 && !Helm.bHoveTo;
    const bool Stalled = Driving && D<9. && Velocity.SizeSquared()<1.30*1.30 && OutSpeed<.65;
    StalledSeconds=FMath::Clamp(StalledSeconds+(Stalled ? Dt : -2.*Dt),0.,2.4);
    if (Driving && StalledSeconds>.55)
    {
        const double Lift=FMath::SmoothStep(.55,1.5,StalledSeconds);
        const double Drift=FMath::Clamp((1.65-OutSpeed)*1.65,0.,2.5);
        Loads.ForceN+=FVector(Out,0)*(MassKg*Lift*Drift);
    }

    const bool Pinned=D<-.30 || (D<1.15 && !Helm.bHoveTo && HeadingOut<-.12 && Velocity.SizeSquared()<.25);
    GroundedSeconds=Pinned ? GroundedSeconds+Dt : 0.;
    if (GroundedSeconds<2.5) return false;
    GroundedSeconds=0;
    return true;
}
}
