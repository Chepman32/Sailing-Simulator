#pragma once

#include "Subsystems/GameInstanceSubsystem.h"
#include "Misc/ConfigCacheIni.h"
#include "SailingCrabs.h"
#include "SailingWallet.generated.h"

struct FSailingCrabStack
{
    static constexpr int32 Capacity = 100;
    ESailingCrab Kind;
    int32 Count = 1;
};

UCLASS()
class USailingWallet : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    void Initialize(FSubsystemCollectionBase& Collection) override
    {
        Super::Initialize(Collection);
        GConfig->GetInt(TEXT("Sailing.Testing"), TEXT("StartingCoins"), Coins, GGameIni);
        Coins = FMath::Max(0, Coins);
    }

    int32 Balance() const { return Coins; }
    bool Spend(int32 Price)
    {
        if (Price <= 0 || Coins < Price) return false;
        Coins -= Price;
        return true;
    }
    static int32 CrabPrice(ESailingCrab Kind) { return Kind == ESailingCrab::Shore ? 1 : 3; }
    TConstArrayView<FSailingCrabStack> Crabs() const { return CrabStacks; }
    void AddCrab(ESailingCrab Kind)
    {
        auto* Stack = CrabStacks.FindByPredicate([Kind](const FSailingCrabStack& Entry) {
            return Entry.Kind == Kind && Entry.Count < FSailingCrabStack::Capacity;
        });
        if (Stack) ++Stack->Count;
        else CrabStacks.Add({Kind, 1});
    }
    int32 CrabSaleValue() const
    {
        int32 Value = 0;
        for (const FSailingCrabStack& Stack : CrabStacks) Value += Stack.Count * CrabPrice(Stack.Kind);
        return Value;
    }
    int32 SellCrabs()
    {
        const int32 Value = CrabSaleValue();
        Coins += Value;
        CrabStacks.Reset();
        return Value;
    }
private:
    int32 Coins = 0;
    TArray<FSailingCrabStack> CrabStacks;
};
