import Foundation

public func canEdit(_ state: BillingFeature.LoadState) -> Bool { state == .fresh }
public func canEditTask(_ status: String) -> Bool { status != "done" }
