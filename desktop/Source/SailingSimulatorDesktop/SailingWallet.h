#pragma once

#include "Subsystems/GameInstanceSubsystem.h"
#include "Misc/ConfigCacheIni.h"
#include "SailingWallet.generated.h"

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
private:
    int32 Coins = 0;
};
